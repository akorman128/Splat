export const MOD = "mod" as const;

export const SHORTCUTS_HINT =
  "Card shortcuts act on the card under the pointer, or the selected one. In the chat view the arrows move between messages while the prompt box is empty.";

export type Shortcut = { keys: string[]; label: string; ownerOnly?: true };
export type ShortcutGroup = { title: string; shortcuts: Shortcut[] };

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Starting something new",
    shortcuts: [
      {
        keys: [MOD, "Shift", "N"],
        label: "Start a new conversation",
        ownerOnly: true,
      },
      { keys: [MOD, "Shift", "S"], label: "Write a new skill", ownerOnly: true },
    ],
  },
  {
    title: "Cards",
    shortcuts: [
      { keys: [MOD, "O"], label: "Open the hovered card" },
      { keys: [MOD, "R"], label: "Regenerate the hovered card", ownerOnly: true },
      { keys: [MOD, "Shift", "C"], label: "Copy the hovered card" },
      { keys: ["Delete"], label: "Delete the selected cards", ownerOnly: true },
      { keys: ["Esc"], label: "Close the open card" },
    ],
  },
  {
    title: "Moving through the graph",
    shortcuts: [
      { keys: ["↑"], label: "Go to the card this one branches from" },
      { keys: ["↓"], label: "Go to the first card branching off this one" },
      { keys: ["←"], label: "Go to the previous branch at this depth" },
      { keys: ["→"], label: "Go to the next branch at this depth" },
    ],
  },
  {
    title: "Chat view",
    shortcuts: [
      { keys: [MOD, "I"], label: "Open the canvas as a chat, and back" },
      { keys: ["↑"], label: "Move to the message above" },
      { keys: ["↓"], label: "Move to the message below" },
      { keys: ["←"], label: "Previous branch of the current message" },
      { keys: ["→"], label: "Next branch of the current message" },
      { keys: ["Esc"], label: "Return to the canvas" },
    ],
  },
  {
    title: "Highlights",
    shortcuts: [
      {
        keys: [MOD, "Shift", "H"],
        label: "Show or hide the highlights and comments panel",
      },
    ],
  },
  {
    title: "Composer",
    shortcuts: [
      { keys: ["Enter"], label: "Send the prompt", ownerOnly: true },
      { keys: ["Shift", "Enter"], label: "Start a new line", ownerOnly: true },
      { keys: ["Esc"], label: "Cancel a staged regeneration", ownerOnly: true },
      { keys: [MOD, "H"], label: "Hide or show the prompt box", ownerOnly: true },
    ],
  },
  {
    title: "Sidebar",
    shortcuts: [
      { keys: [MOD, "B"], label: "Hide or show the sidebar", ownerOnly: true },
    ],
  },
  {
    title: "Help",
    shortcuts: [{ keys: [MOD, "/"], label: "Show the shortcut list" }],
  },
];

export function shortcutGroupsFor(readOnly: boolean): ShortcutGroup[] {
  if (!readOnly) return SHORTCUT_GROUPS;
  return SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter((shortcut) => !shortcut.ownerOnly),
  })).filter((group) => group.shortcuts.length > 0);
}

export function modifierLabelFor(platform: string): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘" : "Ctrl";
}

export function modifierLabel(): string {
  return typeof navigator === "undefined"
    ? "Ctrl"
    : modifierLabelFor(navigator.userAgent);
}
