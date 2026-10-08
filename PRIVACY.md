# Privacy

APOD New Tab has no analytics, telemetry, advertising, account system, or developer-operated backend.

The extension reads the daily page from `apod.com`, with `science.nasa.gov` as a fallback. Date navigation requests dated APOD pages and, when needed, NASA's public archive search endpoint; the search includes only the chosen date. It displays the HTTPS image linked by that page, which may be hosted elsewhere. These hosts receive normal network information, including your IP address and browser request headers. Page requests omit credentials and image requests omit the referrer. Chrome's own network behavior and the hosting websites' privacy policies still apply.

Chrome's most-visited site list is used only to render local shortcuts. Site names and addresses are not sent to APOD or a third-party favicon service. Icons are requested through Chrome's favicon endpoint, whose cache and network behavior are managed by Chrome.

Preferences, custom shortcuts, and the most recently successful APOD's text, date, credits, and image URLs are saved in `chrome.storage.local`. This extension does not use Chrome Sync. Images are not separately archived by the extension. Uninstalling removes locally saved extension data.

The extension has no permission to read your full browsing history, arbitrary tabs, page content on sites you visit, or cookies. It does not inject content scripts into websites. External HTML is parsed in a detached document, and extracted captions and shortcut names are rendered as text.
