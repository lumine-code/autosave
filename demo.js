// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript"],
  viewport: { width: 1100, height: 340 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("autosave/processing.txt");
    await lumine.project.setPaths([fixture("autosave")]);
    // Hold the before frame even if another desktop window takes focus.
    lumine.config.set("autosave.enabled", false);
    lumine.views.getView(state.editor).blur();
    lumine.views.getView(state.editor).focus();
    state.editor.setText("window = 7\nnormalize = true\n");
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "A modified file before moving focus.",
      timeout: 60000,
      async run() {},
      ready(context) {
        const { state } = context;
        return Boolean(state.editor.getFileState() === "modified");
      },
    },
    {
      id: "scene-2",
      file: "demo-2.png",
      caption: "The change saved automatically after switching editors.",
      timeout: 60000,
      async run(context) {
        const { lumine, state, fixture } = context;
        {
          lumine.config.set("autosave.enabled", true);
          state.editor.getElement().focus();
          await lumine.workspace.open(fixture("autosave/notes.txt"));
          await new Promise((r) => setTimeout(r, 500));
          await lumine.workspace.open(state.editor);
        }
      },
      ready(context) {
        const { state } = context;
        return Boolean(
          !(state.editor.getFileState() === "modified") &&
          require("fs").readFileSync(state.editor.getPath(), "utf8") === state.editor.getText(),
        );
      },
    },
  ],
  async cleanup(context) {
    const { lumine } = context;
    lumine.config.unset("autosave.enabled");
  },
};
