# ProduTime Privacy Notice

Last updated: 2026-09-26

ProduTime is designed as a local-first desktop app.

## Default Local Mode

By default, ProduTime stores activity records, settings, reports, and app data
on the user's own device. This can include active application names, window
titles, idle periods, schedule settings, report history, and generated PDFs.

ProduTime has no built-in server. It does not send telemetry, activity
records, usage analytics, or report contents to George Karagioules or to anyone
else unless you set up one of the features below.

## Network Activity

**Update checks (automatic).** About 10 seconds after ProduTime starts, and
then every 4 hours (and after the computer wakes from sleep), it asks GitHub
Releases whether a newer version of ProduTime exists, and downloads an update
when you choose to install one. GitHub receives an ordinary web request, which
includes your IP address and the app version. No activity data is sent.

**Admin server (only after pairing).** ProduTime makes no connection to any
admin server by default. It connects only after someone enters a server
address (which must use https://) and a pair code under Help > Register
Device, and that server approves the device. While paired, ProduTime keeps a
connection to that server and sends it every 10 seconds to 1 minute:

- the device name (the employee name set in ProduTime, or the computer name),
  device ID, local IP address, operating system and app version;
- whether tracking is running and which policy is applied;
- today's and the last 15 minutes' active and idle time, and time per
  application, with website names for browsers (taken from window titles);
- window titles only if the administrator's policy turns title sharing on.

The administrator of that server can also push settings policies, lock the
ProduTime window, and request exports. Unpairing (or the server unpairing the
device) stops the connection and deletes the pairing.

**Email (only if configured).** If you enter SMTP settings, ProduTime sends
scheduled reports, report-failure notices and test emails through that server
to the addresses you set.

**External links.** Links you click open in your web browser.

## Earlier Versions

Versions released before 2026-09-26 connected every install, paired or not, to a
built-in admin server hosted on Railway and sent it the device information and
activity summaries listed above. That hosted server no longer exists. When you
upgrade, ProduTime deletes any pairing with a Railway-hosted server, and the
policy it applied, and makes no further connection until you pair it with a
server yourself.

## Local Data Control

Reports and app data remain on the user's device unless the user or an
administrator exports, emails, syncs, or otherwise shares them through an
enabled feature.

## Contact

George Karagioules
https://www.georgekaragioules.com
