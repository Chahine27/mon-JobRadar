import { describe, expect, it } from "vitest";
import { applicationStage } from "./application";

const d = (day: number) => new Date(Date.UTC(2026, 9, day));

describe("applicationStage", () => {
  it("sans mail : envoyée ; refus marqué à la main : refusée", () => {
    expect(applicationStage([])).toBe("SENT");
    expect(applicationStage([], true)).toBe("REJECTED");
  });

  it("avance sans jamais reculer", () => {
    expect(applicationStage([{ kind: "ACK", receivedAt: d(1) }])).toBe("ACK");
    expect(applicationStage([{ kind: "INTERVIEW", receivedAt: d(2) }, { kind: "ACK", receivedAt: d(3) }])).toBe("INTERVIEW");
    expect(applicationStage([{ kind: "ACK", receivedAt: d(1) }, { kind: "OFFER", receivedAt: d(5) }])).toBe("OFFER");
  });

  it("refus : l'emporte, sauf entretien ou proposition reçus après", () => {
    expect(applicationStage([{ kind: "INTERVIEW", receivedAt: d(1) }, { kind: "REJECTION", receivedAt: d(4) }])).toBe("REJECTED");
    expect(applicationStage([{ kind: "REJECTION", receivedAt: d(1) }, { kind: "ACK", receivedAt: d(2) }])).toBe("REJECTED");
    expect(applicationStage([{ kind: "REJECTION", receivedAt: d(1) }, { kind: "INTERVIEW", receivedAt: d(6) }])).toBe("INTERVIEW");
  });

  it("renvoi vers leur site carrière : en attente de ta candidature sur leur site", () => {
    expect(applicationStage([{ kind: "ACK", receivedAt: d(1) }, { kind: "CAREER_SITE", receivedAt: d(1) }])).toBe("CAREER_SITE");
    expect(applicationStage([{ kind: "CAREER_SITE", receivedAt: d(1) }, { kind: "INTERVIEW", receivedAt: d(5) }])).toBe("INTERVIEW");
    // « J'ai postulé sur leur site » : le suivi reprend (accusé reçu de leur site → « Reçue »).
    expect(applicationStage([{ kind: "CAREER_SITE", receivedAt: d(1) }], false, true)).toBe("SENT");
    expect(applicationStage([{ kind: "CAREER_SITE", receivedAt: d(1) }, { kind: "ACK", receivedAt: d(3) }], false, true)).toBe("ACK");
  });

  it("un mail écarté (« ne concerne pas cette candidature ») ne compte pas", () => {
    expect(applicationStage([{ kind: "REJECTION", receivedAt: d(1), dismissed: true }, { kind: "ACK", receivedAt: d(1) }])).toBe("ACK");
  });
});
