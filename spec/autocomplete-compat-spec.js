const fs = require("fs");
const os = require("os");
const path = require("path");

// Polls with real timers; the spec runner freezes the clock by default.
function conditionPromise(condition, description = "condition", timeout = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startedAt > timeout) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting on ${description}`));
      }
    }, 10);
  });
}

// Autosave saves out from under the suggestion list mid-typing, so the
// interaction is exercised here, beside autosave: the editor bundles
// autocomplete, while autosave installs on demand, and a bundled package's
// suite could never activate this one.
describe("autosave compatibility with autocomplete", () => {
  let editor;
  let editorView;
  let autocompleteManager;
  let createSuggestionsPromise;

  beforeEach(async () => {
    // Anchor the project somewhere small: the harness's default root sits on
    // the OS tmpdir, and repository discovery over it drowns the session in
    // notification noise.
    lumine.workspace.project.setPaths([path.join(__dirname, "fixtures")]);
    jasmine.useRealClock();

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "autosave-autocomplete-"));
    const sample = `var quicksort = function () {
var sort = function(items) {
  if (items.length <= 1) return items;
  var pivot = items.shift(), current, left = [], right = [];
  while(items.length > 0) {
    current = items.shift();
    current < pivot ? left.push(current) : right.push(current);
  }
  return sort(left).concat(pivot).concat(sort(right));
};

return sort(Array.apply(this, arguments));
};
`;
    const filePath = path.join(directory, "sample.js");
    fs.writeFileSync(filePath, sample);

    lumine.config.set("autosave.enabled", true);
    lumine.config.set("autocomplete.enableAutoActivation", true);
    // The suite types one character at a time, and the default minimum word
    // length would reject those prefixes outright.
    lumine.config.set("autocomplete.minimumWordLength", 1);
    lumine.config.set("editor.fontSize", "16");

    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));

    await lumine.packages.activatePackage("autosave");

    editor = await lumine.workspace.open(filePath);
    editorView = lumine.views.getView(editor);

    await lumine.packages.activatePackage("language-javascript");

    const mainModule = (await lumine.packages.activatePackage("autocomplete")).mainModule;
    await conditionPromise(
      () => mainModule.autocompleteManager && mainModule.autocompleteManager.ready,
      "the autocomplete manager to be ready",
    );

    autocompleteManager = mainModule.autocompleteManager;
    const { displaySuggestions } = autocompleteManager;
    const suggestionsPromises = new Set();

    createSuggestionsPromise = function () {
      return new Promise((resolve) => {
        suggestionsPromises.add(resolve);
      });
    };

    spyOn(autocompleteManager, "displaySuggestions").and.callFake((suggestions, options) => {
      displaySuggestions(suggestions, options);
      for (const resolve of suggestionsPromises) {
        resolve();
      }
      suggestionsPromises.clear();
    });
  });

  it("keeps the suggestion list open while saving", async () => {
    // Assert on the suggestion list's model state: the overlay element
    // attaches through the editor component's update loop, which a hidden
    // window defers, while `isActive()` answers synchronously.
    expect(autocompleteManager.suggestionList.isActive()).toBe(false);

    const firstEventPromise = createSuggestionsPromise();
    editor.moveToBottom();
    editor.moveToBeginningOfLine();
    editor.insertText("f");
    await firstEventPromise;
    await conditionPromise(
      () => autocompleteManager.suggestionList.isActive(),
      "the suggestion list to open after typing",
    );

    const secondEventPromise = createSuggestionsPromise();
    editor.save();
    expect(autocompleteManager.suggestionList.isActive()).toBe(true);
    editor.insertText("u");
    await secondEventPromise;
    await conditionPromise(
      () => autocompleteManager.suggestionList.isActive(),
      "the suggestion list to stay open across the second keystroke",
    );

    editor.save();
    expect(autocompleteManager.suggestionList.isActive()).toBe(true);

    // The command is registered on `lumine-text-editor.autocomplete-active`,
    // so the editor element is the natural dispatch target — the overlay
    // element only attaches once the component updates, which a hidden
    // window defers indefinitely.
    lumine.commands.dispatch(editorView, "autocomplete:confirm");
    expect(editor.getBuffer().getLastLine()).toEqual("function");
  }, 60000);
});
