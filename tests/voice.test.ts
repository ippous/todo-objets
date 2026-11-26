import { describe, expect, it } from "vitest";
import { speakable } from "@/lib/voice";

describe("speakable", () => {
  it("retire le markdown et garde le libellé des liens", () => {
    const md = "**3 tâches** en retard :\n- [Vidanger le tracteur](/taches/12)\n- `Clôture` voir https://exemple.fr/x";
    expect(speakable(md)).toBe("3 tâches en retard :\nVidanger le tracteur\nClôture voir");
  });
});
