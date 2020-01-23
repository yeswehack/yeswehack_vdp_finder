const API_ALL_SCOPES_URL = "https://firebounty.com/api/v1/scope/all/url_only/"
const PULIC_SUFFIX_LIST_URL = "https://publicsuffix.org/list/public_suffix_list.dat"

const SECURITY_TXT_PATHS = ['/.well-known/security.txt', '/security.txt'];
const SECURITY_TXT_CACHE_DURATION = 1000 * 60 * 60 * 24

const ANDROID_APP_REGEX = /^[a-z0-9]+\.([a-z0-9]+\.)*[a-z0-9]+$/
const PLAY_STORE_REGEX = /^https?:\/\/play\.google\.com\/store\/apps\/details/
const PLAY_STORE_TESTING_REGEX = /^https:\/\/play\.google\.com\/apps\/testing\/([a-z0-9]+\.([a-z0-9]+\.)*[a-z0-9]+)/

const IOS_APP_REGEX = /^id[0-9]+$/
const APP_STORE_REGEX = /^https?:\/\/(itunes|apps)\.apple\.com\//

const CACHE = { programs: [], security_txt: {}, tab_info: {}, last_programs_update: null, suffix_list: [] };

function get_android_id(uri) {
    const url = new URL(uri)
    const id = url.searchParams.get("id")
    return id ? id : null
}

function get_ios_id(uri) {
    const url = new URL(uri)
    const id = url.pathname.split("/").pop();
    return IOS_APP_REGEX.exec(id) ? id : null
}

function update_color() {
    chrome.browserAction.setIcon({ path: "res/images/FF_ext_icon_" + color + ".svg" });
}

function getTab() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            resolve(tabs[0])
        })
    })
}

function findTopDomain(url) {
    const top = CACHE.suffix_list.find(top => url.endsWith(top))
    if (!top) {
        return url
    }
    const pos = url.length - top.length
    return url.substr(0, pos).split(".").pop()
}

function get_domain_info(urlStr) {
    let url;
    let lax = false;
    try {
        url = new URL(urlStr)
    } catch (e) {
        return {}
    }
    let programs = CACHE.programs.filter(pgm => pgm.web_scopes.some(reg => reg.exec(url)))

    if (PLAY_STORE_REGEX.exec(urlStr)) {
        const app_id = get_android_id(urlStr)
        const android_programs = CACHE.programs.filter(pgm => pgm.android_scopes.some(id => id == app_id))
        programs = [...programs, ...android_programs]
    }

    if (APP_STORE_REGEX.exec(urlStr)) {
        const app_id = get_ios_id(urlStr)
        const ios_programs = CACHE.programs.filter(pgm => pgm.ios_scopes.some(id => id == app_id))
        programs = [...programs, ...ios_programs]
    }

    if (programs.length == 0) {
        const topDomain = findTopDomain(url.hostname)
        if (topDomain) {
            programs = CACHE.programs.filter(pgm => pgm.name.toLowerCase().replace(/ /g, "").indexOf(topDomain) >= 0)
            if (programs.length)
                lax = true;
        }
    }

    const hostname = url.hostname
    const security_txt = CACHE.security_txt[hostname] || { found: false }

    let color = "red"
    if (programs.length) {
        color = lax ? "orange" : "green"
    } else if (security_txt.found) {
        color = "orange"
    }

    chrome.browserAction.setIcon({ path: "res/images/FF_ext_icon_" + color + ".svg" });
    return { programs: programs, security_txt: security_txt, color: color, last_programs_update: CACHE.last_programs_update, lax: lax }
}

function scope_to_ios_id(scope) {
    if (IOS_APP_REGEX.exec(scope)) {
        return scope
    }

    if (APP_STORE_REGEX.exec(scope)) {
        return get_ios_id(scope)
    }

    return null
}

function scope_to_android_id(scope) {
    if (ANDROID_APP_REGEX.exec(scope)) {
        return scope
    }

    if (PLAY_STORE_REGEX.exec(scope)) {
        return get_android_id(scope)
    }

    if (match = PLAY_STORE_TESTING_REGEX.exec(scope)) {
        return match[1]
    }
    return null
}

function scope_to_regex(scope) {

    // extract protocol
    let proto = 'https?://'
    if ((match = /^(https?:\/\/).*/.exec(scope))) {
        proto = match[1]
        scope = scope.substr(proto.length)
    }

    // escape all regex char except *, * is replaced by .*
    let reg = scope.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*]/g, '.$&')

    // most of the time *.example.com also means example.com
    if (reg.startsWith(".*\\.")) {
        reg = `(?:.+\\.)?${reg.substr(4)}`
    }
    return new RegExp(`^${proto}${reg}`)
}


function convert_program(program) {
    const web_scopes = program.scopes.in_scopes.filter(scope => scope.scope_type == "web_application")
        .map(scope => scope_to_regex(scope.scope))

    const android_scopes = program.scopes.in_scopes.filter(scope => scope.scope_type == "android_application")
        .map(scope => scope_to_android_id(scope.scope)).filter(id => id !== null)

    const ios_scopes = program.scopes.in_scopes.filter(scope => scope.scope_type == "ios_application")
        .map(scope => scope_to_ios_id(scope.scope)).filter(id => id !== null)

    if (program.tag == "cvd" &&
        web_scopes.length == 0 &&
        android_scopes.length == 0 &&
        ios_scopes.length == 0) {
        return {
            ...program,
            web_scopes: [scope_to_regex(new URL(program.url).hostname)],
            android_scopes: [],
            ios_scopes: []
        }
    }
    return { ...program, web_scopes: web_scopes, android_scopes: android_scopes, ios_scopes: ios_scopes }
}

async function update_public_suffix_list() {
    await fetch(PULIC_SUFFIX_LIST_URL).then(r => r.text()).then(data => {
        const suffix_list = data.split("\n")
            .filter(line => !line.startsWith("//") && line)
            .map(line => `.${line}`)
            .sort((a, b) => b.length - a.length)

        CACHE.suffix_list = suffix_list
    })
}

async function update_all_scopes(force_update) {
    const cache = force_update ? 'reload' : 'no-cache'
    const scopes = await fetch(API_ALL_SCOPES_URL, { cache: cache }).then(r => r.json()).catch(err => {
        console.error(`Request all scopes failed with error: ${err}`);
        return
    })

    if (scopes) {
        const programs = scopes.pgms.map(convert_program)
        CACHE.programs = programs
        CACHE.last_programs_update = new Date().toLocaleString();
    }
}


async function check_security_txt(urlStr, force_update) {
    let hostname, protocol;
    try {
        const url = new URL(urlStr)
        hostname = url.hostname
        protocol = url.protocol
        if (["http:", "https:"].indexOf(protocol) < 0)
            return
    } catch (e) {
        return;
    }

    const current_date = new Date()
    const entry = CACHE.security_txt[hostname]

    /* Check if already visited */
    if (!force_update && entry && (current_date - entry.last_update) < SECURITY_TXT_CACHE_DURATION) {
        return
    }

    /* Reset entry */
    CACHE.security_txt[hostname] = {
        last_update: current_date,
        content: "",
        found: false,
    }

    for (let i = 0; i < SECURITY_TXT_PATHS.length; ++i) {
        const path = SECURITY_TXT_PATHS[i]
        const security_txt_url = `${protocol}//${hostname}${path}`
        const content = await fetch(security_txt_url, { cache: 'no-cache', redirect: 'manual' })
            .then(r => r.status == 200 && r.text())
            .then(txt => txt && !txt.startsWith("<") && txt)
        if (content) {
            /* update and stop if found */
            CACHE.security_txt[hostname].content = content
            CACHE.security_txt[hostname].url = security_txt_url
            CACHE.security_txt[hostname].found = true
            return
        }
    }
}

async function update_cache(force_update) {
    return Promise.all([
        update_public_suffix_list(),
        update_all_scopes(force_update)
    ])
}

chrome.tabs.onUpdated.addListener(_ => {
    getTab().then(tab => {
        check_security_txt(tab.url, false).then(_ => {
            get_domain_info(tab.url)
        })
    })
});

chrome.tabs.onActivated.addListener(_ => {
    getTab().then(tab => {
        check_security_txt(tab.url, false).then(_ => {
            get_domain_info(tab.url)
        })
    })
});

chrome.runtime.onInstalled.addListener(_ => {
    update_cache(false)
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    switch (request.msg) {
        case "FETCH_ALL_SCOPES":
            Promise.all([
                update_cache(true),
                check_security_txt(request.data)
            ]).then(sendResponse).catch(_ => console.error("ERROR"))
            break;
        case "GET_DOMAIN_INFO":
            sendResponse(get_domain_info(request.data))
            break;
        default:
            console.error(`Unhandled message "${request.msg}"`)
            break;
    }
    return true;
})
