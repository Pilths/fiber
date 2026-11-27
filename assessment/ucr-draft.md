# User Change Request: Fiber Dashboard

| | |
| --- | --- |
| Document | User Change Request: Fiber Dashboard |
| Version | 0.2 |
| Prepared by | [name] |
| Project Sponsor | [name] |
| Date | [date] |

**Change Record**

| Version | Date | Author | Change |
| --- | --- | --- | --- |
| 0.1 | [date] | [name] | First draft |
| 0.2 | [date] | [name] | Aligned to the UCR template and revised for formal language |

**Approved By**

| Name | Role | Signature | Date |
| --- | --- | --- | --- |
| [name] | Project Sponsor | | |
| [name] | Business Owner | | |
| [name] | IT Security | | |

---

## 1. Objective

This document defines the business and functional requirements for the Fiber Dashboard, a web application intended to serve as the master record for fibre cores and reservations, with Excel and KMZ files retained as data sources. It establishes the baseline for go-live and handover, and covers the following areas:

* Visibility of sites, segments, cores and available capacity on a map with route lines, supported by search by customer, segment or core
* Route planning between two sites, with alternative route options
* Core reservation requests, including admin approval, release, follow-up of stale reservations and an admin Action needed view, all supported by a full history
* Calculated loss and Measured loss per core, with warning levels
* Admin data editing with edit history, Excel and KMZ uploads, and KMZ download of a segment
* Sign-in, user roles and account management

---

## 2. Introduction

This requirement is raised by [requesting team] to replace the manual Excel-based process currently used to track fibre cores and reservations.

At present, fibre core information is fragmented across separate Excel workbooks and KMZ files. Core availability, route information and loss readings are not viewed together, and all reservations are consolidated and updated manually by a single person. This approach limits visibility of available cores, allows reservations to remain held after they are no longer required, and provides no audit trail of requests and changes. Consequently, customer requests may be delayed while core availability is being confirmed.

The Fiber Dashboard is proposed as a single planning tool that presents core availability, routes and loss information in one place. Planners select two sites, review feasible routes with available cores, and submit a reservation request for admin approval. Reservations held for more than three months are flagged for review, and every action is recorded with the user and time. Existing Excel and KMZ data is loaded through upload screens, after which the dashboard becomes the master record.

Project Sponsor: [name, title]

---

## 3. Overview

### 3.1 Background

Fibre core tracking currently relies on:

* A Reservation workbook, containing one row per reservation (region, site pair, distance, cores secured, requestor, request date, core assignment and remarks)
* A site master workbook of approximately 36,000 sites, maintained by a separate team
* KMZ files of route drawings, which are viewed separately in Google Earth

At present:

* The workbooks are maintained manually by a single person. Other users have view access, but all reservations are processed through that person
* Available cores are calculated manually by subtracting assigned cores from cores secured
* No reminder exists for reservations that are no longer required
* Measured loss is not compared with the expected loss of each core
* The source data contains inconsistencies
* [Examples of process failures, such as lost reservations, double bookings or time spent]

### 3.2 Stakeholders

| Role | Responsibility |
| --- | --- |
| Project Sponsor | Owns the request and approves the scope and go-live |
| Business Owner | Resolves open questions and accepts the delivery |
| Planner | Identifies available cores, plans routes, submits reservation requests, retains or requests release of stale reservations, and withdraws their own pending requests |
| Admin | Performs all planner functions, and additionally approves requests, releases cores, assigns cores, edits data, records Measured loss tests, uploads Excel and KMZ files, manages map elements and administers user accounts |
| Field team | Conducts physical loss tests. Results are recorded by an admin, and the team does not hold accounts |
| Site master owner team | Maintains the site master workbook that is uploaded by the admin |
| Data owner | Confirms data rules, for example that two sites are joined by no more than one segment |
| IT Security | Confirms sign-in and account requirements for go-live |

### 3.3 Assumptions

* Users access the dashboard from desktop computers within the company network
* The dashboard supports up to 50 concurrent users
* Planner and admin are the only user roles, and more than one admin exists
* The Excel files retain their current column headers
* KMZ line titles identify the two sites of a segment, for example "SITE A-SITE B"
* All dates and the three-month stale rule follow Malaysia time
* The map does not depend on any external map service
* Production data has not yet been loaded

---

## 4. Project Details

### 4.1 Objective

* Enable a planner to identify available cores and submit a request within two minutes
* Ensure every reservation held for more than three months is flagged until it is retained or released
* Ensure all new reservations after go-live are created in the dashboard
* Ensure every reservation, core and data change is traceable to a user and time

### 4.2 Drivers

* Planners cannot see which cores are available without requesting the information from the workbook owner
* Cores remaining reserved after they are no longer required
* Dependency on a single person for all reservations
* Absence of an audit trail
* Risk of double booking
* Route drawings held separately from the inventory

### 4.3 Current Issues / Limitations

* Fragmented data: reservations, sites, routes and loss readings are held in separate Excel workbooks and KMZ files, with no single view
* Manual maintenance of workbooks by a single person who processes every reservation
* Manual calculation of available cores
* No reminder for aged reservations
* No comparison of loss per core
* Inconsistent source data

### 4.4 Desired State / Ambition

* A single dashboard serving as the master record, with Excel and KMZ as data sources
* Route lines and segments presented on one map
* Admin approval before cores are held
* Automatic flagging of stale reservations
* Calculated loss and Measured loss presented together for each core
* Complete history with no deletion of records

---

## 5. Scope of Delivery

| In Scope | Out of Scope |
| --- | --- |
| Sign-in, forced and voluntary password change, and sign-out | Enterprise single sign-on |
| User account management by admins: creation, password reset, deactivation and activation | Email alerts for new requests |
| Inventory: map, map filters, Site A to B route planner, segment diagram, Cores table and core details | Daily email digest of stale reservations |
| Header search by customer, segment or core, and customer view on the map | Correction of customer or planned date on an approved reservation |
| Reserve box for requesting cores along a route | Different core counts per segment within one route reservation |
| Approvals by admins: approval, rejection, release and declining of release requests | Measured loss coverage view |
| Withdrawal, retention (Keep), release request and release | Extended loss view and "lowest loss" route option |
| Core assignment for count-only reservations by admins | Excel export of reservations |
| My reservations and the admin Action needed view | Clusters |
| Admin editing of segments and sites, including Region, fiber cut and restoration | Sites and data centres view (site details and racks) |
| Port assignment for a single core and Paste ports for a segment end | Undo of a site master upload |
| Calculated loss and Measured loss per core with warning levels, and recording of Measured loss tests | One-time site master load |
| Excel uploads for Sites, Segments and Reservations, and closure of the reservation import | Monitoring sheet import |
| KMZ import of route lines assigned to segments and displayed on the map | Interpretation of the free-text Port Info column |
| Map elements from KMZ: display, hiding, recolouring, reassignment and addition from KMZ | Joint closures on the map |
| KMZ download of a segment | Dark theme |
| Visible history of reservations, cores, edits and Measured loss tests | Mobile and tablet use |

---

## 6. Requirements

### 6.1 General Requirements

* GR-001: The system MUST record every change with the user who made it and the time it was made.
* GR-002: The system MUST NOT delete any record. Reservations, events, measurements and edits MUST be retained as history, and accounts MUST be deactivated rather than deleted.
* GR-003: The system MUST NOT modify a reservation in place. Every change to a reservation MUST be recorded as a new event.
* GR-004: After the initial import, the dashboard MUST serve as the master record, with Excel and KMZ files acting as data sources.
* GR-005: The system MUST NOT allow later uploads to overwrite a field that has been edited in the dashboard.
* GR-006: Remarks MUST be optional for every edit and event.
* GR-007: The system MUST NOT indicate status by colour alone. A symbol, pattern or word MUST always accompany the colour.
* GR-008: The system MUST allow only admins to approve, reject or release a reservation.
* GR-009: The system MUST NOT allow any user to reserve more cores on a segment than its Free to reserve figure.
* Priorities: **MUST have** = launch blocker; **GOOD to have** = target for launch; **NICE to have** = future release.

### 6.2 Functional Requirements

#### 6.2.1 Sign-in and Accounts

**MUST Have**

1. FR-001: The system MUST require users to sign in with a username and password. Self-registration MUST NOT be available.
2. FR-002: The system MUST require users to change a new or reset password at their next sign-in, and MUST allow users to change their own password from the account menu.
3. FR-003: The system MUST allow admins to create planner and admin accounts. The temporary password MUST be displayed only once.
4. FR-004: The system MUST allow admins to reset passwords and to deactivate or activate accounts. A deactivated user MUST NOT be able to sign in, and their name MUST remain in the history.
5. FR-005: The system MUST throttle repeated failed sign-in attempts for the same username.
6. FR-006: The system MUST NOT display admin screens (Approvals, Upload and Users) to planners.

**NICE to Have**

* Enterprise single sign-on

#### 6.2.2 Inventory, Map and Search

**MUST Have**

1. FR-007: Each segment MUST connect two sites, and any two sites MUST be connected by no more than one segment.
2. FR-008: Each segment MUST display one core for each verified core. A segment without a verified core count MUST be shown as "Not verified" and MUST NOT be available for reservation.
3. FR-009: Each core MUST hold one of the following statuses: Available, Requested, Reserved or In service.
4. FR-010: The map MUST display each segment as a line labelled with its Free to reserve figure. Where a route line exists, the segment MUST follow it; otherwise, a straight line between its sites MUST be shown.
5. FR-011: The header search MUST return customers, segments (entered as "A-B" in either order) and cores. Selecting a customer MUST highlight that customer's segments on the map.
6. FR-012: The selected segment or route MUST be retained in the page link so that it can be shared.

#### 6.2.3 Route Planning

**MUST Have**

1. FR-013: The system MUST allow a planner to enter Site A, Site B and the number of cores required per segment, and to select either Shortest distance or Most free cores.
2. FR-014: The system MUST present up to five route options, each showing its segments, total distance in km, Calculated loss and lowest Free to reserve figure. The most suitable option MUST be labelled "Best match".
3. FR-015: An option with insufficient free cores or an unverified segment MUST be marked, placed last in the list and excluded from reservation.
4. FR-016: Segments marked as cut MUST NOT be used in route options.

**NICE to Have**

* "Lowest loss" route option

#### 6.2.4 Reservation Requests

**MUST Have**

1. FR-017: A reservation MUST begin from "Reserve on this route", where the planner selects exactly the required number of Available cores on every segment of the route.
2. FR-018: A customer MUST be specified for each request, while the planned date and SRF ID MUST be optional. When a new customer is added, the system MUST warn of similar existing names.
3. FR-019: A submitted request MUST hold its cores as Requested. No core MUST be reserved until an admin approves the request.
4. FR-020: Where two planners select the same core, the system MUST accept the first request and inform the second planner which cores are no longer available.
5. FR-021: A route reservation MUST be recorded as a single request across all of its segments.

**NICE to Have**

* Different core counts per segment within one route reservation

#### 6.2.5 Approval, Rejection and Withdrawal

**MUST Have**

1. FR-022: The Approvals tab MUST list pending requests and release requests in order of age, oldest first, with a waiting count shown on the tab.
2. FR-023: The system MUST allow an admin to approve or reject a pending request as a whole. Approved cores MUST become Reserved, and rejected cores MUST become Available.
3. FR-024: The system MUST allow a planner to withdraw their own pending request, after which its cores MUST immediately become Available.
4. FR-025: Pending requests MUST NOT expire.

**NICE to Have**

* Email alerts to admins for new requests

#### 6.2.6 Stale Reservations and Retention

**MUST Have**

1. FR-026: An approved reservation MUST be marked as Stale when three months have passed since its last approval or retention, unless a release request is pending.
2. FR-027: Stale reservations MUST appear under the Stale chip, in the Action needed list, as a count badge on the My reservations tab, and in the Cores table.
3. FR-028: The Keep action MUST be available only for stale reservations, to the requesting planner or an admin. Retaining a reservation MUST restart the three-month period.

**NICE to Have**

* Daily email digest of stale reservations for each planner

#### 6.2.7 Release

**MUST Have**

1. FR-029: The system MUST allow a planner to request the release of selected cores from their own approved reservation. These cores MUST remain Reserved until an admin decides, and only one release request MUST be pending at any time.
2. FR-030: The system MUST allow an admin to release selected cores from any approved reservation directly, or to decline a release request.
3. FR-031: A release MUST free only the selected cores, while the reservation and its history MUST be retained. Releasing all cores MUST end the reservation.

**NICE to Have**

* Correction of the customer or planned date on an approved reservation

#### 6.2.8 Count-only Reservations and Core Assignment

**MUST Have**

1. FR-032: Each reservation row imported from Excel MUST be recorded as a count-only reservation, which holds a number of cores on a segment without identifying specific cores.
2. FR-033: Count-only reservations MUST appear as an "Unassigned" group in the Cores table and MUST reduce the Free to reserve figure.
3. FR-034: The system MUST allow an admin to assign Available cores to an approved count-only reservation, up to the number that remains unassigned. Incorrectly assigned cores MUST be released and requested again.

#### 6.2.9 My Reservations and Action Needed

**MUST Have**

1. FR-035: Planners MUST see only their own reservations, filtered by the chips All, Action needed, Pending and Stale.
2. FR-036: The Action needed list MUST include stale reservations, pending release requests and reservations on cut segments.
3. FR-037: Admins MUST additionally have an Action needed view covering the reservations of all planners.
4. FR-038: Each reservation MUST display its age in days and only the actions permitted to the viewer.

**NICE to Have**

* Excel export of reservations

#### 6.2.10 Admin Data Editing

**MUST Have**

1. FR-039: The system MUST allow an admin to edit a segment's sites, distance, Region, verified core count and Total cores.
2. FR-040: The system MUST allow an admin to edit a site's name, Region and coordinates. Site names MUST NOT contain the character "-".
3. FR-041: The system MUST refuse a reduction of the verified core count where it would leave too few Available cores for count-only reservations.
4. FR-042: The system MUST allow an admin to mark a segment as cut and to restore it. Reservations on a cut segment MUST be added to the Action needed list.
5. FR-043: The system MUST allow an admin to set the ports of a single core, or to paste a port column for a segment end with a preview beforehand. Port labels MUST follow the format FDF1-MOD2-T3-P5 or ODF1-P5 and MUST be unique within each site.

**NICE to Have**

* Sites and data centres view (site details and racks)

#### 6.2.11 Visible History

**MUST Have**

1. FR-044: Each reservation MUST display its history, showing the action taken, the user, the time and any Remarks.
2. FR-045: Core details MUST display the history of the core and all of its Measured loss tests, with the most recent first.
3. FR-046: The Edit segment and Edit site screens MUST display recent edits, showing the field, the previous and new values, the user and the time.

#### 6.2.12 Excel Uploads

**MUST Have**

1. FR-047: Every upload MUST present a preview before any data is saved. No data MUST be saved until the admin confirms.
2. FR-048: Every row MUST be assigned a status of Ready, Needs review or Rejected, together with a reason. The system MUST NOT infer missing values to allow a row to pass.
3. FR-049: The Sites upload MUST mark a missing site as inactive rather than deleting it, and MUST block a file containing 10% or more fewer rows than the dashboard unless the admin confirms.
4. FR-050: The Segments upload MUST create and update segments between known sites. A row referring to an unknown site MUST be marked Needs review, and a blank cell MUST NOT clear an existing value.
5. FR-051: The Reservations upload MUST import each row as a count-only reservation and MUST NOT change an existing reservation.
6. FR-052: The system MUST allow an admin to close the reservation import once. After closure, new reservations MUST be created only in the dashboard.

**NICE to Have**

* Undo of a site master upload
* Monitoring sheet import
* Interpretation of the free-text Port Info column

#### 6.2.13 KMZ Import, Map Elements and Download

**MUST Have**

1. FR-053: The system MUST allow an admin to upload a KMZ file and select the folders to be read. No data MUST be saved until the admin applies the import.
2. FR-054: Each line MUST be listed with a suggested segment, derived from its title or from the location of its end points. The admin MUST be able to confirm, change or exclude each line.
3. FR-055: An applied line MUST be stored as drawn against the selected segment. A segment MAY hold more than one route line.
4. FR-056: A KMZ upload MUST NOT create or delete a segment, nor change its distance, cores or route type.
5. FR-057: Other KMZ folders MUST be stored as map elements attached to a segment or site. The admin MUST be able to show, hide, recolour, reassign or add them from the Edit segment and Edit site screens.
6. FR-058: Map elements MUST NOT be deleted; they MAY only be hidden. Every change MUST be recorded in the history.
7. FR-059: The system MUST allow any user to download the selected segment as a KMZ file for use in Google Earth.

**NICE to Have**

* Clusters

### 6.3 UI / UX Requirements

**MUST Have**

* A desktop layout with a minimum width of 1200 pixels, using a light theme
* Accessibility in line with WCAG 2.1 AA, including readable text, sufficient contrast and full keyboard operation
* Top-level tabs: Inventory and My reservations for all users, and Approvals (with a waiting count) and Upload for admins. Users and Change password are located in the account menu
* An Inventory page presenting the map with the Site A to B panel and map filters alongside it, the segment diagram below, and the Cores table thereafter
* A map in which line patterns indicate route type, site shapes indicate site kind, and closely located sites are grouped into a count badge
* Reservation performed in a box displayed over the Inventory page
* Concise status labels, with no helper text beneath titles or controls

**NICE to Have**

* Dark theme

### 6.4 Loss and Network Rules Requirements

**MUST Have**

1. FR-060: Loss MUST be recorded against a core rather than the whole cable, and MUST be labelled as either "Calculated loss" or "Measured loss".
2. FR-061: Calculated loss MUST be derived from the segment distance using the agreed formula (one splice every 4 km and two connectors per segment). The loss of a route MUST be the sum of its segments. Where no distance is recorded, no Calculated loss MUST be shown, rather than 0 dB.
3. FR-062: The system MUST allow an admin to record a Measured loss test for a core, comprising the value in dB, test date, test type and field team. Tests MUST be added to the history and MUST NOT overwrite earlier results.
4. FR-063: Loss MUST be displayed in core details and the Reserve box, and MUST NOT be displayed on the map or the segment diagram.
5. FR-064: Each Measured loss MUST display a warning level according to its deviation above the Calculated loss:

| Deviation | Level | Indicator |
| --- | --- | --- |
| 0 to 3%, or below Calculated loss | Normal | Green circle |
| 3 to 7% | Warning | Amber triangle |
| 7 to 10% | High | Red diamond |
| Above 10% | Off-scale | Red cross |

6. FR-065: Route type MUST be derived from the two end sites and MUST NOT be entered manually: two data centres = DC-DC; a data centre and a TOC = DC-TOC; a data centre and any other site = Metro; all other cases = Trunk.
7. FR-066: A fiber cut MUST apply to the whole segment. A cut segment MUST have a Free to reserve figure of zero and MUST NOT be used in route options.

**NICE to Have**

* Measured loss coverage view
* Extended loss view
* Configurable warning bands

### 6.5 Timeline Requirements

| Phase | Expected Date | Impact / Remarks |
| --- | --- | --- |
| Requirement Finalisation | [TBC] | Requires all open questions to be resolved and this document to be approved |
| UAT | [TBC] | Production Excel and KMZ data to be loaded and verified by planners and admins |
| Go-Live | [TBC] | The reservation import is to be closed after the initial load |
| Handover | [TBC] | This document, the requirements and the decisions log are to be transferred to the receiving team |

### 6.6 Open Questions

| # | Question | Owner | Needed By |
| --- | --- | --- | --- |
| 1 | Are local accounts acceptable for go-live, or is single sign-on required? | IT Security | [TBC] |
| 2 | Should an admin be prevented from approving their own request when other admins are available? | Business Owner | [TBC] |
| 3 | Are email notifications (new request alerts and the stale digest) required for go-live? | Business Owner, IT | [TBC] |
| 4 | Is a correction screen required for the customer or planned date? | Business Owner | [TBC] |
| 5 | Is a Measured loss coverage view required? | Business Owner | [TBC] |
| 6 | Should the loss warning bands be configurable? | Business Owner | [TBC] |
| 7 | Should the site master move to a one-time load? | Site master owner team | [TBC] |
| 8 | Do production reservation rows contain blank or incomplete core assignments? | Data owner | [TBC] |
| 9 | Which title format will the KMZ drawing team adopt for route lines? | Data owner | [TBC] |
| 10 | Which data retention and compliance rules apply? | IT | [TBC] |

---

## 7. System Architecture (High Level)

* **Users:** Planners and admins, each with an individual account, accessing the dashboard from office desktop browsers
* **Application layer:** The Fiber Dashboard web portal, covering inventory and map, route planning, reservations and approvals, loss, admin editing, uploads and user accounts
* **Integrations:** Excel uploads (Sites, Segments and Reservations), KMZ uploads, and KMZ download for Google Earth. This release does not include email or any external map service
* **Data layer:** A central database holding the full history of reservations, cores, edits, measurements, route lines, map elements and uploads. No records are deleted

---

## 8. Risks and Issues

A score of 15 or above (Impact × Possibility) is considered high.

| Risk / Issue | Impact (1-5) | Possibility (1-5) | Response |
| --- | --- | --- | --- |
| Production data may not load cleanly | 4 | 4 | Load production Excel and KMZ data before go-live and resolve every row marked Needs review |
| Reservations may continue to be made in Excel after go-live | 4 | 3 | Close the reservation import after the initial load and communicate the change to users |
| System knowledge is held by a single developer | 4 | 3 | Hand over this document, the requirements and the decisions log |
| An admin may approve their own request | 3 | 3 | Confirm the rule (6.6, item 2) and review approvals in the history in the interim |
| Without email, new requests and stale reservations may be overlooked | 3 | 3 | Require users to review the dashboard daily and confirm the email requirement (6.6, item 3) |
| KMZ line titles may not match site names | 2 | 4 | Use location-based suggestions and agree a title format (6.6, item 9) |
| An incorrect customer or date may be recorded on an approved reservation | 2 | 3 | Release and request the cores again, and confirm the need for a correction screen (6.6, item 4) |

---

## 9. Expectations and Conclusion

This document sets out the business requirements for the Fiber Dashboard. Upon approval, it will serve as the baseline for UAT, go-live and handover. Reviewers are requested to confirm their respective sections and to respond to the open questions by [date]. Any change after approval will be subject to the change control process.

---

## Appendix A. Flowchart Context

### A1. Reservation Request through a Route

* Actor: Planner
* Steps:
  1. The planner enters Site A, Site B, the number of cores required per segment, and either Shortest distance or Most free cores.
  2. The system presents up to five route options.
  3. Decision: does every segment have sufficient free cores and a verified core count? If not, the option is blocked and the planner selects another. If so, the planner selects "Reserve on this route".
  4. The planner selects cores on each segment, specifies a customer, and optionally enters a planned date and SRF ID.
  5. Decision: are all selected cores still available? If not, the request is refused and the planner selects again. If so, the cores become Requested.
* End states: the request is pending; or no request is created.

### A2. Approval, Rejection and Withdrawal

* Actors: Admin, Planner
* Steps:
  1. The admin opens Approvals, ordered by age.
  2. Decision: approve or reject? On approval, the cores become Reserved and the three-month period begins. On rejection, the cores become Available and the planner can view the Remarks.
  3. Before a decision is made, the planner may withdraw the request, after which the cores become Available.
* End states: Approved; Rejected; Withdrawn.

### A3. Stale Reservation and Retention

* Actors: Planner, Admin
* Steps:
  1. An approved reservation without approval or retention for more than three months appears as Stale in the Action needed list.
  2. Decision: retain, request release (planner) or release (admin)? Retention restarts the three-month period. Release proceeds as described in A4.
* End states: approved and no longer stale; or the release process.

### A4. Release

* Actors: Planner, Admin
* Planner path: the planner selects cores from their own reservation and submits a release request. Decision (admin): release or decline? Release frees the selected cores, while declining keeps them Reserved.
* Admin path: the admin selects cores from any approved reservation and releases them directly.
* Decision: have all cores been released? If so, the reservation ends. If not, the remaining cores stay Reserved.
* End states: partially released; fully released; declined.

### A5. Core Assignment for Count-only Reservations

* Actor: Admin
* Steps:
  1. A count-only reservation appears in the Unassigned group of the Cores table.
  2. The admin selects Available cores, up to the number that remains unassigned.
* End states: partially assigned; fully assigned.

### A6. Excel Uploads

* Actor: Admin
* Steps:
  1. The admin selects Sites, Segments or Reservations and the relevant file.
  2. Decision: does the file pass its validation checks? If not, the upload is blocked with a message.
  3. The preview displays each row as Ready, Needs review or Rejected.
  4. Decision: apply or discard? Applying saves Ready rows and preserves dashboard edits, while discarding saves nothing.
  5. For Reservations only: once the import is closed, reservation rows are ignored with a warning.
* End states: applied; discarded; blocked.

### A7. KMZ Import

* Actor: Admin
* Steps:
  1. The admin uploads a KMZ file and selects the folders to be read.
  2. The system lists each line with a suggested segment, and the admin may request suggestions based on location.
  3. The admin confirms, changes or excludes each line, and selects a segment or site for each remaining folder.
  4. Decision: apply or discard? Applying stores the route lines and map elements, while discarding saves nothing.
* End states: route lines displayed on the map and map elements attached; or no data saved.

### A8. Segment and Site Editing

* Actor: Admin
* Steps:
  1. The admin opens Edit segment or Edit site and changes the relevant fields, with optional Remarks.
  2. Decision: would reducing the verified core count leave too few cores? If so, the change is refused.
  3. Decision: is the segment marked as cut? If so, its Free to reserve figure becomes zero, it is excluded from routes, and its reservations are added to the Action needed list. Restoration reverses this.
* End states: the record is updated, recorded in the history and protected from later uploads.

### A9. User Accounts

* Actors: Admin, User
* Steps:
  1. The admin creates an account, and the temporary password is displayed once.
  2. The user signs in and is required to change the password.
  3. The admin may reset a password, or deactivate or activate an account.
* End states: active user; deactivated user (unable to sign in, with history retained).

---

## Appendix B. Glossary

| Term | Definition |
| --- | --- |
| Site | Any end point of a segment, such as a site, a building or equipment within it |
| Segment | A connection between two sites. Two sites are connected by no more than one segment |
| Route | A label for a group of segments. Routing is performed over segments |
| Core | A single fibre within the cable of a segment |
| Core verification | The check that determines how many cores a segment displays |
| Verified cores | The number of cores a segment displays, as determined by core verification |
| Total cores | The number of cores in the cable, recorded for information only |
| Free to reserve | Available verified cores less unassigned count-only holdings. This is zero when the segment is cut or not verified |
| Count-only reservation | A reservation holding a number of cores without identifying them, imported from Excel |
| Stale | An approved reservation without approval or retention for more than three months |
| Action needed | Reservations requiring a decision: stale, awaiting release, or on a cut segment |
| Calculated loss | The expected loss of a core, derived from the segment distance |
| Measured loss | The loss obtained from a physical field test |
| Fiber cut | A segment marked as cut, with a Free to reserve figure of zero and excluded from routes |
| Remarks | An optional free-text note recorded with an edit or event |
| Needs review | An upload row that requires admin review before it can be saved |
| SRF ID | [Definition required: service request reference] |
| KMZ | A Google Earth file containing points, lines and areas |
| Route line | A KMZ line stored against a segment and displayed on the map |
| Map element | A KMZ folder attached to a segment or site and displayed on the map |
