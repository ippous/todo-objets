// Menu contextuel « Ajouter cette image à Carnet » : mémorise l'image puis ouvre la fenêtre de l'extension.
const MENU_ID = "carnet-image";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "Ajouter cette image à Carnet", contexts: ["image"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  const pending = {
    kind: "image",
    srcUrl: info.srcUrl,
    page: { url: tab?.url || info.pageUrl || "", title: tab?.title || "", favIconUrl: tab?.favIconUrl || "", windowId: tab?.windowId },
    at: Date.now(),
  };
  // Pas d'await avant openPopup : l'ouverture doit rester liée au clic de l'utilisateur.
  void chrome.storage.session.set({ pending });
  chrome.action.openPopup().catch(() =>
    chrome.windows.create({ url: chrome.runtime.getURL("popup.html?fenetre=1"), type: "popup", width: 420, height: 640 }),
  );
});
