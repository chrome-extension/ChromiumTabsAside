function TogglePane(tab)
{
	if (tab.url.startsWith("http")
		&& !tab.url.includes("chrome.google.com")
		&& !tab.url.includes("microsoftedge.microsoft.com"))
	{
		chrome.tabs.executeScript(tab.id,
			{
				file: "js/aside-script.js",
				allFrames: true,
				runAt: "document_idle"
			});
	}
	else if (tab.url == chrome.runtime.getURL("TabsAside.html"))
		chrome.tabs.remove(tab.id);
	else
	{
		chrome.tabs.create(
			{
				url: chrome.extension.getURL("TabsAside.html"),
				active: true
			},
			(activeTab) =>
				chrome.tabs.onActivated.addListener(function TabsAsideCloser(activeInfo) 
				{
					chrome.tabs.query({ url: chrome.extension.getURL("TabsAside.html") }, (result) =>
					{
						if (result.length)
							setTimeout(() =>
							{
								result.forEach(i => 
									{
									if (activeInfo.tabId != i.id)
										chrome.tabs.remove(i.id);
									});
							}, 200);
						else chrome.tabs.onActivated.removeListener(TabsAsideCloser);
					});
				}));
	}
}

function ProcessCommand(command)
{
	switch(command)
	{
		case "set-aside":
			SaveCollection();
			break;
		case "toggle-pane":
			chrome.tabs.query(
				{
					active: true,
					currentWindow: true
				},
				(tabs) => TogglePane(tabs[0])
			)
			break;
	}
}

chrome.browserAction.onClicked.addListener((tab) =>
{
	chrome.storage.sync.get({ "setAsideOnClick": false }, values => 
	{
		if (values?.setAsideOnClick)
			SaveCollection();
		else
			TogglePane(tab);
	});
});

// Adding context menu options
chrome.contextMenus.create(
	{
		id: "toggle-pane",
		contexts: ['all'],
		title: chrome.i18n.getMessage("togglePaneContext")
	}
);
chrome.contextMenus.create(
	{
		id: "set-aside",
		contexts: ['all'],
		title: chrome.i18n.getMessage("setAside")
	}
);

var collections = JSON.parse(localStorage.getItem("sets")) || [];
var shortcuts;
chrome.commands.getAll((commands) => shortcuts = commands);

chrome.commands.onCommand.addListener(ProcessCommand);
chrome.contextMenus.onClicked.addListener((info) => ProcessCommand(info.menuItemId));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) =>
{
	switch (message.command)
	{
		case "openTab":
			chrome.tabs.create({ url: message.url });
			break;
		case "loadData":
			sendResponse(collections);
			break;
		case "saveTabs":
			SaveCollection();
			break;
		case "restoreTabs":
			RestoreCollection(message.collectionIndex, message.removeCollection);
			sendResponse();
			break;
		case "deleteTabs":
			DeleteCollection(message.collectionIndex);
			sendResponse();
			break;
		case "removeTab":
			RemoveTab(message.collectionIndex, message.tabIndex);
			sendResponse();
			break;
		case "getShortcuts":
			sendResponse(shortcuts);
			break;
	}
});

// This function updates the extension's toolbar icon
function UpdateTheme()
{
	var theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
	var iconStatus = collections.length ? "full" : "empty";

	var basePath = "icons/" + theme + "/" + iconStatus + "/";

	chrome.browserAction.setIcon(
		{
			path:
			{
				"128": basePath + "128.png",
				"48": basePath + "48.png",
				"32": basePath + "32.png",
				"16": basePath + "16.png"
			}
		});

	// Updating badge counter
	chrome.browserAction.setBadgeText({ text: collections.length < 1 ? "" : collections.length.toString() });
}

UpdateTheme();
chrome.windows.onFocusChanged.addListener(UpdateTheme);
chrome.tabs.onUpdated.addListener(UpdateTheme);
chrome.tabs.onActivated.addListener(UpdateTheme);

// Set current tabs aside
function SaveCollection()
{
	chrome.tabs.query({ currentWindow: true }, (rawTabs) =>
	{
		var tabs = rawTabs.filter(i => i.url != chrome.runtime.getURL("TabsAside.html") && !i.pinned && !i.url.includes("//newtab") && !i.url.includes("about:"));

		if (tabs.length < 1)
		{
			alert(chrome.i18n.getMessage("noTabsToSave"));
			return;
		}

		var collection =
		{
			timestamp: Date.now(),
			tabsCount: tabs.length,
			titles: tabs.map(tab => tab.title ?? ""),
			links: tabs.map(tab => tab.url ?? ""),
			icons: tabs.map(tab => tab.favIconUrl ?? ""),
			thumbnails: tabs.map(tab => thumbnails.find(i => i.tabId == tab.id)?.url ?? "")
		};

		var rawData;
		if (localStorage.getItem("sets") === null)
			rawData = [collection];
		else
		{
			rawData = JSON.parse(localStorage.getItem("sets"));
			rawData.unshift(collection);
		}

		localStorage.setItem("sets", JSON.stringify(rawData));

		collections = JSON.parse(localStorage.getItem("sets"));

		var newTabId;
		chrome.tabs.create({}, (tab) => 
		{
			newTabId = tab.id;
			chrome.tabs.remove(rawTabs.filter(i => !i.pinned && i.id != newTabId).map(tab => tab.id));
		});

		UpdateTheme();
	});
}

function DeleteCollection(collectionIndex)
{
	collections = collections.filter(i => i != collections[collectionIndex]);
	localStorage.setItem("sets", JSON.stringify(collections));

	UpdateTheme();
}

function RestoreCollection(collectionIndex, removeCollection)
{
	collections[collectionIndex].links.forEach(i => 
	{
		chrome.tabs.create(
			{
				url: i,
				active: false
			},
			(createdTab) =>
			{
				chrome.storage.sync.get({ "loadOnRestore" : true }, values => 
				{
					if (!(values?.loadOnRestore))
						chrome.tabs.onUpdated.addListener(function DiscardTab(updatedTabId, changeInfo, updatedTab) 
						{
							if (updatedTabId === createdTab.id) {
								chrome.tabs.onUpdated.removeListener(DiscardTab);
								if (!updatedTab.active) {
									chrome.tabs.discard(updatedTabId);
								}
							}
						});
				});
			});
	});

	if (!removeCollection)
		return;

	collections = collections.filter(i => i != collections[collectionIndex]);
	localStorage.setItem("sets", JSON.stringify(collections));

	UpdateTheme();
}

function RemoveTab(collectionIndex, tabIndex)
{
	var set = collections[collectionIndex];
	if (--set.tabsCount < 1)
	{
		collections = collections.filter(i => i != set);
		localStorage.setItem("sets", JSON.stringify(collections));

		UpdateTheme();
		return;
	}

	var titles = [];
	var links = [];
	var icons = [];

	for (var i = set.links.length - 1; i >= 0; i--)
	{
		if (i == tabIndex)
			continue;

		titles.unshift(set.titles[i]);
		links.unshift(set.links[i]);
		icons.unshift(set.icons[i]);
	}

	set.titles = titles;
	set.links = links;
	set.icons = icons;

	localStorage.setItem("sets", JSON.stringify(collections));

	UpdateTheme();
}

var thumbnails = [];

function AppendThumbnail(tabId, tab)
{
	if (!tab.active || !tab.url.startsWith("http"))
		return;

	chrome.tabs.captureVisibleTab(
		{
			format: "jpeg",
			quality: 1
		},
		(dataUrl) =>
		{
			if (!dataUrl)
			{
				console.log("Failed to retrieve thumbnail");
				return;
			}

			console.log("Thumbnail retrieved");
			var item = thumbnails.find(i => i.tabId == tabId);
			if (item)
				item.url = dataUrl;
			else
				thumbnails.unshift(
					{
						tabId: tabId,
						url: dataUrl
					}
				);
		}
	);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) =>
{
	if (changeInfo.status === "complete")
		AppendThumbnail(tabId, tab)
});