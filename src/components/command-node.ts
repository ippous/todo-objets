// Nœud @@nom de l'éditeur : enregistré comme <span data-commande="nom">@@nom</span>
// et affiché avec le résultat de la commande, recalculé à chaque ouverture.
import { mergeAttributes, Node } from "@tiptap/react";
import { runCommand, type CommandContext } from "@/lib/command-runtime";

export const CommandNode = Node.create<{ context: () => CommandContext }>({
  name: "commande",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { context: () => ({}) };
  },

  addAttributes() {
    return {
      name: {
        default: "",
        parseHTML: (el) => (el.getAttribute("data-commande") ?? "").toLowerCase(),
        renderHTML: (attrs) => ({ "data-commande": attrs.name }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-commande]" }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), `@@${node.attrs.name}`];
  },

  renderText({ node }) {
    return `@@${node.attrs.name}`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      const name = String(node.attrs.name);
      dom.className = "commande-live";
      dom.dataset.commande = name;
      dom.contentEditable = "false";
      dom.textContent = `@@${name}`;
      dom.title = `@@${name} : recalculé à chaque affichage`;
      void runCommand(name, this.options.context()).then((r) => {
        if (r.ok) dom.textContent = r.value || "∅";
        else {
          dom.textContent = `@@${name} ⚠`;
          dom.title = r.error;
        }
      });
      return { dom };
    };
  },
});
