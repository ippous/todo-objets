// Menus contextuels « Ajouter cette image à Carnet » et « Ajouter ce document à Carnet » (lien vers un fichier) :
// mémorisent l'élément puis ouvrent la fenêtre de l'extension.
const MENU_ID = "carnet-image";
const DOC_MENU_ID = "carnet-document";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Ajouter cette image à Carnet", contexts: ["image"] });
    chrome.contextMenus.create({ id: DOC_MENU_ID, title: "Ajouter ce document à Carnet", contexts: ["link"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const isImage = info.menuItemId === MENU_ID && info.srcUrl;
  const isDoc = info.menuItemId === DOC_MENU_ID && info.linkUrl;
  if (!isImage && !isDoc) return;
  const pending = {
    kind: isImage ? "image" : "document",
    srcUrl: info.srcUrl,
    linkUrl: info.linkUrl,
    page: { url: tab?.url || info.pageUrl || "", title: tab?.title || "", favIconUrl: tab?.favIconUrl || "", windowId: tab?.windowId },
    at: Date.now(),
  };
  // Pas d'await avant openPopup : l'ouverture doit rester liée au clic de l'utilisateur.
  void chrome.storage.session.set({ pending });
  chrome.action.openPopup().catch(() =>
    chrome.windows.create({ url: chrome.runtime.getURL("popup.html?fenetre=1"), type: "popup", width: 420, height: 640 }),
  );
});
