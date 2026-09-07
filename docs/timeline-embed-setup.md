# Timeline embedding update

In the Apps Script project, replace only `doGet()` in Code.gs with:

```javascript
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Work History')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

Insert the script from `timeline-auto-height.html` immediately before the closing
`</body>` tag in the Apps Script index.html. Keep the existing timeline code.
Update the existing web app deployment to a new version so its URL remains the same.

The portfolio sends an instance token in the embed URL. The timeline reads it
through google.script.url.getLocation and reports its content height to the
portfolio. The host checks the Google origin and token before resizing.
ResizeObserver tracks search results, layout changes, and expanded role details.
The content wrapper is measured rather than viewport height to allow shrinking.

Until this is deployed in Apps Script, the portfolio retains a scrollable frame
so all role details remain accessible. Height messages target the production
portfolio origin, https://shoegun.github.io, rather than arbitrary embedding sites.
