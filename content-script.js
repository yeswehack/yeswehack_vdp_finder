// Content script runs in page context and can bypass SSL warnings user has accepted

const SECURITY_TXT_PATHS = ['/.well-known/security.txt', '/security.txt'];

async function fetchSecurityTxt() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;

    // Only check HTTP/HTTPS pages
    if (!["http:", "https:"].includes(protocol)) {
        return null;
    }

    for (const path of SECURITY_TXT_PATHS) {
        const security_txt_url = `${protocol}//${hostname}${path}`;

        try {
            const response = await fetch(security_txt_url, {
                cache: 'no-cache',
                redirect: 'follow',
                credentials: 'omit' // Don't send cookies for security.txt
            });

            if (response.ok) {
                const content = await response.text();

                // Check if content looks like security.txt (not HTML)
                if (content &&
                    content.trim().length > 0 &&
                    !content.trim().startsWith("<!DOCTYPE") &&
                    !content.trim().startsWith("<html")) {

                    console.log(`[VDP Finder Content] Found security.txt at ${security_txt_url}`);
                    return {
                        found: true,
                        content: content,
                        url: security_txt_url,
                        hostname: hostname
                    };
                }
            }
        } catch (err) {
            console.log(`[VDP Finder Content] Failed to fetch ${security_txt_url}: ${err.message}`);
        }
    }

    return {
        found: false,
        hostname: hostname
    };
}

// Listen for requests from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.msg === "CHECK_SECURITY_TXT") {
        fetchSecurityTxt().then(sendResponse);
        return true; // Will respond asynchronously
    }
});

// Also check on page load and notify background
fetchSecurityTxt().then(result => {
    if (result) {
        chrome.runtime.sendMessage({
            msg: "SECURITY_TXT_RESULT",
            data: result
        });
    }
});
