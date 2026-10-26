import { ThemeProvider } from "@krizaka/ui/native";
import { render, screen } from "@testing-library/react-native";
import * as React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "@/i18n";
import { StageNotice } from "@/ui/StageNotice";

jest.mock("@/config", () => ({ stage: "dev" }));

const wrap = async (node: React.ReactElement) =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <ThemeProvider>
        <I18nProvider locale="fr">{node}</I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>,
  );

describe("the development-version notice of the phone app (yomizaka#364)", () => {
  it("shows in the stage dev", async () => {
    await wrap(<StageNotice />);
    expect(screen.getByText("Version de développement")).toBeTruthy();
  });

  it("renders nothing in production", async () => {
    await wrap(<StageNotice stageOf="prod" />);
    expect(screen.queryByText("Version de développement")).toBeNull();
  });
});
