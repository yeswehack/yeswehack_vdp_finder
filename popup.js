/* Utils */
const $ = s => document.querySelector(s)
const $$ = s => Array.from(document.querySelectorAll(s))


function create_scope_entry(scope) {
    const li = document.createElement("li")
    li.innerText = scope
    return li
}

function create_program_entry(program) {
    const li = document.createElement("li")
    const a = document.createElement("a")

    a.classList.add("pgm-name")
    a.href = program.firebounty_url
    a.target = "_blank"
    a.innerText = program.name
    li.appendChild(a)
    return li
}



function update_content(domain_info) {
    const programs = domain_info.programs
    $("#last-update").innerText = domain_info.last_programs_update
    document.documentElement.style.setProperty("--status-color", `var(--${domain_info.color})`)

    if (domain_info.security_txt && domain_info.security_txt.found) {
        $("#security-txt-content").innerText = domain_info.security_txt.content
        $("#security-txt-info").classList.remove("hidden")
        $("#security-txt-link").href = domain_info.security_txt.url
    } else {
        $("#no-security-txt-info").classList.remove("hidden")
    }

    if (programs.length) {
        $$("#not-load,#no-program").forEach(el => el.classList.add("hidden"))
        $("#program-info").classList.remove("hidden")

        if (domain_info.lax) {
            const count = programs.length == 1 ? "a" : programs.length
            $("#program-info-title").innerText = `We couln't find a VDP with this exact scope. But we found ${count} VDP that might match!`
            $("#program-info-title").classList.add("lax")
        } else {
            const count = programs.length == 1 ? "A" : programs.length
            $("#program-info-title").innerText = `YAY! WE FOUND ${count} VPD!`
            $("#program-info-title").classList.remove("lax")
        }

        $("#program-list").innerHTML = ""
        programs.forEach(info => {
            $("#program-list").appendChild(create_program_entry(info))

        })
    } else {
        $$("#not-load,#program-info").forEach(el => el.classList.add("hidden"))
        $("#no-program").classList.remove("hidden")
    }
}

document.addEventListener("DOMContentLoaded", _ => {
    getTab().then(tab => {
        const url = new URL(tab.url)
        $("#domain-host").innerText = url.hostname;

        $('#btn-refresh-all').addEventListener('click', _ => {
            $('#btn-refresh-all').classList.add("active")
            chrome.runtime.sendMessage({ msg: "FETCH_ALL_SCOPES", data: tab.url }, _ => {
                chrome.runtime.sendMessage({ msg: "GET_DOMAIN_INFO", data: tab.url }, update_content);
                $('#btn-refresh-all').classList.remove("active")
            });
        });
    })
});


function getTab() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            resolve(tabs[0])
        })
    })
}

/* on open */

getTab().then(tab => {
    chrome.runtime.sendMessage({ msg: "GET_DOMAIN_INFO", data: tab.url }, update_content);
})
