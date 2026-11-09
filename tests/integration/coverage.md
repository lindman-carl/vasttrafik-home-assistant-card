# Browser regression migration inventory

The replacement runs the production card inside real Home Assistant. User flows
use only routed external Västtrafik fixtures. `contracts.spec.ts` explicitly tests
lower-level browser contracts, not Home Assistant user flows; it never mocks HA.

| Former page / assertion                                                                      | Replacement                                                                         |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| loading: initial spinner, success, empty, failure exit loading                               | card.spec.ts: loading states                                                        |
| loading: long badge shrinks, short badge resets                                              | card.spec.ts: badge sizing                                                          |
| language: configuration errors, Swedish/English override, automatic and unsupported fallback | editor.spec.ts: runtime locale and validation                                       |
| language: nested header override and removal                                                 | editor.spec.ts: automatic language reset                                            |
| language: real selector choices/events preserve configuration                                | editor.spec.ts: save/reopen all configuration fields                                |
| pinning: matching journey IDs, not another journey on same line                              | card.spec.ts: journey pin identity                                                  |
| pinning: multiple pins, ordering, unpin                                                      | card.spec.ts: multiple pins                                                         |
| pinning: empty data/stop changes never fabricate rows                                        | card.spec.ts: absent pin persistence                                                |
| pinning: recreation/localStorage persistence                                                 | card.spec.ts: reload pin persistence                                                |
| pinning: missing GID cannot pin                                                              | contracts.spec.ts: missing journey GID; pinned-departures.test.ts: empty GID        |
| pinning: highlight 10% alpha without fading badge/text                                       | card.spec.ts: highlight opacity                                                     |
| pinning: two tables share pins without overwrite                                             | card.spec.ts: multiple cards                                                        |
| pinning: storage events update connected tables                                              | card.spec.ts: real two-tab pin synchronization                                      |
| lifecycle: disconnect aborts, late results ignored                                           | card.spec.ts: navigation cancellation; contracts.spec.ts: ignored-abort late result |
| lifecycle: stop change cancels obsolete work, latest only, no overlap                        | card.spec.ts: stop-change race; contracts.spec.ts: ignored-abort stop-change race   |
| lifecycle: queued work cleared, reconnect once                                               | contracts.spec.ts: queued refresh cleared/reconnect                                 |
| lifecycle: invalid config cancels and localizes error without requests                       | editor.spec.ts: runtime locale and validation                                       |
| lifecycle: malformed top-level config throws                                                 | contracts.spec.ts: malformed top-level config                                       |
| lifecycle: long Retry-After schedules 120 seconds                                            | card.spec.ts: Retry-After deferral                                                  |

Additional compatibility coverage: actual add/edit/save/reopen controls, resource
loading/picker help, theme/layout/sizing, irrelevant HA updates, retained same-stop
data on refresh failure, and strict external-network isolation.

This inventory is a migration gate, not proof that tests passed. Consult command
output for results. The old pages are removed only after this inventory is complete
and the replacement suite has passed.
