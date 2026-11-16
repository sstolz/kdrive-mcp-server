<!-- Accepted beta guide recovery text, F-024 v2 D-8. -->

The image is pushed before npm is published, because a GHCR version can be
deleted while an npm version can never be reused.

- when npm published but `read-back` failed, re-run only the failed
  `read-back` job or verify by hand with
  `npm view @sstolz/kdrive-mcp-server@<version>` and
  `docker buildx imagetools inspect ghcr.io/sstolz/kdrive-mcp-server:<version>`;
  a new dispatch of that version is refused by BR-363, as intended;
- when `npm publish` reports a failure, first check with `npm view` whether
  the registry accepted it anyway; if it did, verify the published version by
  hand with the read-back commands, and `read-back`, skipped because its
  `needs` failed, is not re-run;
- when the image is pushed but npm is not published (the second approval is
  rejected, `release-check` fails in `publish-npm`, or `npm publish` reports a
  failure and `npm view` does not find the version), re-run the `publish-npm`
  job (its `release-check` in phase `npm` expects the pushed image), or delete
  the GHCR version and dispatch again;
- when the second approval expires (GitHub cancels a run waiting 30 days and
  allows no re-run after 30 days), delete the GHCR version and dispatch again
  while the release commit is `main`'s HEAD, otherwise release the next beta;
- when the image push reports a failure and GHCR does not have the version,
  re-run the failed `publish-image` job or dispatch again;
- when the image push reports a failure but GHCR has the version,
  `publish-npm` never ran and npm is unpublished: the owner deletes the GHCR
  version and dispatches again, or releases the next beta;
- deleting the GHCR version and dispatching again works only while the
  release commit is still `main`'s HEAD (BR-361); otherwise the next beta is
  released.
