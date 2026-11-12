import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const typedFiles = [
  "src/**/*.ts",
  "tests/**/*.ts",
  "scripts/**/*.ts",
  "vitest.config.ts",
];

// BR-144: every disable directive names its rules and carries a " -- reason";
// the Sonar line-suppression marker is forbidden because it silently
// suppresses every rule on a line.
const sonarMarker = new RegExp(`\\b${"NO"}${"SONAR"}\\b`, "u");
const justification = {
  meta: {
    type: "problem",
    messages: {
      unjustified:
        "Lint suppressions must name their rules and give a ' -- reason'.",
      marker: "The Sonar suppression marker is forbidden; justify a rule.",
    },
    schema: [],
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const text = comment.value.trim();
          if (sonarMarker.test(text))
            context.report({ loc: comment.loc, messageId: "marker" });
          const directive =
            /^eslint-disable(?:-next-line|-line)?(?=\s|$)(.*)$/su.exec(text);
          if (!directive) continue;
          const [rules, reason] = (directive[1] ?? "").split(/\s--\s/u, 2);
          // A directive without rule names would also silence this report,
          // so it stops the lint run instead of reporting a problem.
          if (!rules?.trim())
            throw new Error(
              `Unjustified blanket lint suppression at line ${String(comment.loc.start.line)}: name the rules and give a ' -- reason'.`,
            );
          if (!reason?.trim())
            context.report({ loc: comment.loc, messageId: "unjustified" });
        }
      },
    };
  },
};

// BR-144 v2: an inline configuration comment (ESLint directive grammar:
// `eslint`, `eslint-env`, `global` or `globals`, then whitespace or the end)
// could turn off any rule for its file, including the suppression rule above,
// which would then never run. A processor runs before any rule configuration
// is applied, so it stops the lint run instead.
const configComment = /^(?:eslint(?:-env)?|globals?)(?:\s|$)/u;
const inlineConfigGuard = {
  meta: { name: "kdrive/inline-config-guard" },
  preprocess(text) {
    let comments;
    try {
      comments =
        tseslint.parser.parseForESLint(text, {
          comment: true,
          loc: true,
          range: true,
        }).ast.comments ?? [];
    } catch {
      // ESLint reports the parse error itself on the unchanged text.
      return [text];
    }
    for (const comment of comments)
      if (
        comment.type === "Block" &&
        configComment.test(comment.value.trimStart())
      )
        throw new Error(
          `Inline ESLint configuration comment at line ${String(comment.loc.start.line)}: configure rules in eslint.config.mjs instead.`,
        );
    return [text];
  },
  postprocess(messages) {
    return messages.flat();
  },
  supportsAutofix: true,
};

export default tseslint.config(
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**", "artifacts/**"],
  },
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: typedFiles,
  })),
  { ...sonarjs.configs.recommended, files: typedFiles },
  {
    name: "kdrive/typed",
    files: typedFiles,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { kdrive: { rules: { "justified-suppressions": justification } } },
    processor: inlineConfigGuard,
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "kdrive/justified-suppressions": "error",
    },
  },
  {
    // BR-144 bounded test allowlist. Each entry is justified here, asserted
    // exactly by tests/quality-commands.test.ts and listed in the PR body.
    // It never applies to src/** or scripts/**.
    name: "kdrive/tests-allowlist",
    files: ["tests/**/*.ts"],
    rules: {
      // Tests dereference fixture structure they just built; a wrong
      // assumption throws and fails the test, which is the intended outcome.
      "@typescript-eslint/no-non-null-assertion": "off",
      // Tests build diagnostics and fixture text from numbers and unknown
      // values; implicit string conversion is the intended behaviour there.
      "@typescript-eslint/restrict-template-expressions": "off",
      // Same reason for fixture strings concatenated with numbers.
      "@typescript-eslint/restrict-plus-operands": "off",
      // The Docker-only toolchain deliberately runs git, make, sh and node
      // from the dev image PATH in integration fixtures.
      "sonarjs/no-os-command-from-path": "off",
      // Clear-text URLs are negative fixtures that the code must reject.
      "sonarjs/no-clear-text-protocols": "off",
      // Expected values are sorted in code-unit order on ASCII identifiers,
      // which is the deterministic order the assertions compare against.
      "sonarjs/no-alphabetical-sort": "off",
      // Negative fixtures remove optional keys by name from cloned objects.
      "@typescript-eslint/no-dynamic-delete": "off",
      // Parameterised fixtures select variants with compact conditionals.
      "sonarjs/no-nested-conditional": "off",
    },
  },
);
