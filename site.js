// OS detection: label the primary download button and mark the matching row.
(function () {
  var ua = navigator.userAgent;
  var os = /Mac/i.test(ua) ? "mac" : /Win/i.test(ua) ? "win" : /Linux|X11/i.test(ua) ? "linux" : null;
  if (!os) return;

  var primary = document.getElementById("download-primary");
  var alt = document.getElementById("download-alt");

  // Only macOS (Apple silicon) ships an installer today; on other platforms
  // point the primary button at the releases page and say so plainly.
  if (os === "mac") {
    if (primary) primary.textContent = "Download for macOS (.dmg)";
    if (alt) alt.textContent = "Apple silicon. Windows and Linux builds are on the way.";
  } else {
    if (primary) {
      primary.textContent = "See releases";
      primary.setAttribute(
        "href",
        "https://github.com/sybil-solutions/local-studio/releases"
      );
    }
    if (alt) {
      alt.textContent =
        os === "win"
          ? "Windows installer is on the way — macOS (.dmg) is ready now."
          : "Linux build is on the way — macOS (.dmg) is ready now.";
    }
  }

  var row = document.querySelector('.dl-row[data-os="' + os + '"]');
  if (row) row.classList.add("is-current");
})();
