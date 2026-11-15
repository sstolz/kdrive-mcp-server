// Shared BR-321 and BR-387 v2 changelog checks.
function check(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

// BR-321 v3: the #104 Fixed and Added lines live in the first release section
// citing #104 in file order, or under Unreleased when there is no release
// section. Returns the heading of the section that holds them.
const RELEASE_HEADING =
  /^## \[\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?\] - \d{4}-\d{2}-\d{2}$/u;

export function changelogTicketSection(
  changelog: string,
  ticket: string,
  fixedMarker: string,
  addedMarker: string,
): string {
  // BR-387 v2: an empty Added marker for #16 selects Fixed-only validation
  // with the ticket bullet prefix at line start and no extra text marker.
  const fixedOnly = ticket === "#16" && addedMarker === "";
  const cites = new RegExp(`${ticket}\\b`, "u");
  const sections = changelog
    .split(/^(?=## )/mu)
    .filter((part) => part.startsWith("## "))
    .map((part) => {
      const end = part.indexOf("\n");
      return end < 0
        ? { heading: part, body: "" }
        : { heading: part.slice(0, end), body: part.slice(end + 1) };
    });
  const releases = sections.filter((s) => RELEASE_HEADING.test(s.heading));
  const cited = releases.find((s) => cites.test(s.body));
  const target =
    ticket === "#104" && releases.length > 0
      ? cited
      : (cited ?? sections.find((s) => s.heading === "## [Unreleased]"));
  check(target, `no changelog section holds the ${ticket} lines`);
  const holds = (name: string, marker: string) => {
    const body =
      new RegExp(
        `^### ${name}\\n([\\s\\S]*?)(?=^### |(?![\\s\\S]))`,
        "mu",
      ).exec(target?.body ?? "")?.[1] ?? "";
    return body
      .split(/^(?=- )/mu)
      .some(
        (entry) =>
          cites.test(entry) &&
          (fixedOnly
            ? entry.startsWith(`- ${ticket} `)
            : entry.includes(marker)),
      );
  };
  check(holds("Fixed", fixedMarker), `missing ${ticket} Fixed line`);
  if (!fixedOnly)
    check(holds("Added", addedMarker), `missing ${ticket} Added line`);
  return target?.heading ?? "";
}

// BR-321 v3: the #104 lines.
export function changelogAuditSection(changelog: string): string {
  return changelogTicketSection(
    changelog,
    "#104",
    "GHSA-mrhx-c7xc-m3w5",
    "make audit",
  );
}

// BR-321 v4: the #12 lines (Fixed: the tarball install no longer resolves
// Zod 3; Added: make install-check and its CI step). F-027 v2: only the
// text before the `## [0.6.0-beta.1]` heading is searched, because that
// section and older ones cite tickets of the archived repository.
const FIXED_12_MARKER = "no longer resolves Zod 3";
const ADDED_12_MARKER = "make install-check";
export function changelogTicket12Section(changelog: string): string {
  return changelogTicketSection(
    currentRepositoryChangelog(changelog),
    "#12",
    FIXED_12_MARKER,
    ADDED_12_MARKER,
  );
}

// BR-321 v4 / BR-387 v2: archived ticket numbers are outside the search.
export function currentRepositoryChangelog(changelog: string): string {
  const archived = changelog.search(/^## \[0\.6\.0-beta\.1\]/mu);
  return archived < 0 ? changelog : changelog.slice(0, archived);
}

export function changelogFixture(
  ...sections: [heading: string, fixed: string, added: string][]
): string {
  let text = "# Changelog\n\nIntro.\n";
  for (const [heading, fixed, added] of sections) {
    text += `\n${heading}\n`;
    if (added) text += `\n### Added\n\n${added}`;
    if (fixed) text += `\n### Fixed\n\n${fixed}`;
  }
  return text;
}
