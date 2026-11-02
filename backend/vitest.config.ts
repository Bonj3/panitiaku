import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "src/modules/finance/**/*.ts",
        "src/modules/invitations/**/*.ts",
        "src/modules/organization/**/*.ts",
        "src/middleware/authenticate.ts",
        "src/middleware/event-membership.ts",
        "src/middleware/require-event-role.ts",
      ],
      exclude: ["**/*.types.ts", "**/*.validator.ts", "**/*.routes.ts", "**/*.controller.ts"],
    },
  },
});
