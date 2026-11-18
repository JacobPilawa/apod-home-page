# Privacy

APOD Home Page has no analytics, advertising, accounts, or backend.

The extension reads the daily page from `apod.com`, with `science.nasa.gov` as a fallback. Date navigation requests dated APOD pages and, when needed, NASA's public archive search endpoint; the search includes only the chosen date. It displays the HTTPS image linked by that page, which may be hosted elsewhere. These hosts receive normal network information, including your IP address and browser request headers. Page requests omit credentials and image requests omit the referrer. Chrome's own network behavior and the hosting websites' privacy policies still apply.

Chrome's most-visited site list is used only to render local shortcuts. Site names and addresses are not sent to APOD or a third-party favicon service. Icons are requested through Chrome's favicon endpoint, whose cache and network behavior are managed by Chrome.

Preferences, custom shortcuts, and the most recently successful APOD's text, date, credits, and image URLs are saved in `chrome.storage.local`. This extension does not use Chrome Sync. Images are not separately archived by the extension. Uninstalling removes locally saved extension data.

Sun and moon times are calculated locally. Chrome handles automatic location detection; the extension caches rounded coordinates locally for five minutes. You can enter coordinates instead in Customize. Coordinates are not sent to APOD or an astronomy service.

Weather requests send coordinates rounded to two decimal places to `api.open-meteo.com`, which also receives normal network information such as your IP address. Requests omit credentials and the referrer. The response supplies the location's time zone; no city search or additional location service is used. The forecast is cached locally for 15 minutes to avoid a request for every new tab. If an update fails, forecasts up to six hours old remain available; hover over the conditions to see when they were updated. The selected temperature unit stays in local storage. See [Open-Meteo’s privacy policy](https://open-meteo.com/en/terms).

The extension has no permission to read your full browsing history, arbitrary tabs, page content on sites you visit, or cookies. It does not inject content scripts into websites. External HTML is parsed in a detached document, and extracted captions and shortcut names are rendered as text.
