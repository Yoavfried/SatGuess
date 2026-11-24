# Contributing

Bug reports, Hebrew copy improvements, map fixes and pull requests are welcome.

Use Node.js 24+ and `npm start` for the local API-backed app. There are no external runtime packages or separate database service to install. SQLite state is created under `.data/` and stays local.

For a gameplay issue, include the steps to reproduce, browser, selected difficulty and place collection. For a questionable target, include its displayed name and source link.

Keep interface changes focused on the map and the player's next action. Check both desktop and mobile layouts, keyboard controls and right-to-left text.

Place-data changes need a reusable source, an authentic Hebrew name, a supported category and coordinates inside the playable area. Preserve source IDs and license metadata. Review repeated names and branches within each hint square; do not append a city merely to disambiguate a prompt.

For server changes, preserve server-owned scoring, immutable daily deadlines, idempotent guesses and resume behavior. Keep comparisons restricted to comparable first exposures, exclude the current player, and suppress percentiles below 30 references. Cover lifecycle and SQLite behavior with meaningful fixtures.

Run `npm test` and `npm run check` before opening a pull request. Do not include `.data/`, SQLite files, browser cookies or private attempt exports in a pull request. Original code contributions are made under MIT; data and bundled third-party material must retain their applicable licenses.
