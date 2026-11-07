# The dashboard, built with AG Studio

Minder's dashboard ([live](https://minder-2hey.onrender.com/dashboard)) is Maya's spending statement: everything her agent tried to buy, what Minder did about each purchase, and where every dollar is now. It is also where she signs the purchases that are waiting for her. It is an AG Studio 3.0 report (`ag-studio` and `ag-studio-react` 3.0.0) with three pages, three widget types of our own, page filters, a connected data model, Minder's own theme, and two of our AI agents working alongside Studio's.

<p align="center"><img src="assets/ag-overview.jpg" alt="The Overview page: four KPI tiles, two button filters, Minder's money-flow sankey, Minder's calls, money paid to each store, and a cheque waiting for the owner's signature" width="100%"></p>
<p align="center"><sub>The Overview page, with one purchase waiting for the owner (local demo data). Its $189 shows as held in PayPal in the money flow, and as a cheque on the right.</sub></p>

## What the owner sees

- **Three pages.** *Overview* (what was spent, what was kept safe, where the money went, what is waiting for her), *Tricks caught* (what store pages told the agent) and *Recovery* (orders that went wrong after payment, and how the money came back). The tab labels carry live counts.
- **Filters, and clicks that filter.** Two button filters, *Minder's call* and *Store*, narrow the whole page. So does a click on a block of the money flow, a store in the bar chart or a quote on the *Tricks caught* page. Every widget follows, across tables, including the KPI tiles and the cheques (all but the budget gauge, which shows a rule rather than purchases).
- **A dashboard that acts.** A purchase over the owner's limit appears as a cheque with **Sign and pay** and **Decline**. PayPal is already holding the money; her click captures it or releases it.
- **Live.** Come back to the tab after sending ShopBot shopping, and the new purchase is already there: the dashboard fetches the purchase log again whenever the page becomes visible, or on **Refresh**. The layout, the page and the filters stay as they were.
- **Customize with AI.** The button opens Studio's editor with its AI assistant. The prompt starters are the questions an owner actually has: *Why was it blocked?*, *Check with PayPal*, *What if*, *Anything to sign?*, *Money flow by store* and *Paper trail* (a grid of one order's signed receipts).
- **It remembers.** Whatever the owner changes in the editor, by hand or by asking the AI, is kept in her browser and comes back on her next visit. **Restore the default layout** puts the original back.
- **Export.** Grids export to CSV and charts download as images, from each widget's toolbar.
- **On a phone** the report keeps its content in a single column with its own theme and heights, and editing waits for a larger screen.

<p align="center"><img src="assets/ag-filtered.jpg" alt="The Overview filtered to Blocked: the money flow, the donut, the bar chart and the KPI tiles all narrow to blocked purchases, and the cheque widget says nothing is waiting" width="100%"></p>
<p align="center"><sub>Filtered to <i>Blocked</i>: $238 that never left the owner, and nothing paid.</sub></p>

## Three widget types of our own

All three are registered with `createWidgets` next to Studio's built-in types, and listed first in the widget menu under *Minder* ([`widgets.ts`](../src/components/studio/widgets.ts)). Each comes with a data mapping, a form, a format shape that Studio validates AI edits against, and a description written for Studio's agents, so the AI can place and configure them like any built-in chart.

<p align="center"><img src="assets/ag-compose.jpg" alt="Studio's Compose panel in edit mode, with a Minder group at the top: Money flow, What stores told your agent, and Waiting for your signature" width="360"></p>

| Widget | What it shows | How it is mapped |
|---|---|---|
| **Money flow** ([`MoneyFlowWidget.tsx`](../src/components/studio/MoneyFlowWidget.tsx)) | A sankey of every dollar the agent asked to spend: which check settled it, what happened at checkout, and where the money is now. Ribbons take the colour of where the money ended up: green stayed with the owner, amber is waiting, slate reached a store. Clicking a block filters the page. | 2 to 5 category fields, in order, as stages, plus an amount. Its own format options: show amounts, show stage names. |
| **What stores told your agent** ([`StoreTricksWidget.tsx`](../src/components/studio/StoreTricksWidget.tsx)) | The exact words store pages hid for AI agents, as the AI review caught them, each stamped with what Minder did. Clicking a quote filters the page to that store. | Quote, store, outcome and order total. |
| **Waiting for your signature** ([`ChequesWidget.tsx`](../src/components/studio/ChequesWidget.tsx)) | Every purchase PayPal is holding for the owner, drawn as a cheque with **Sign and pay** and **Decline**. The widget asks Studio for the purchases whose status is *Waiting for you*, so page filters apply, then shows each one's full record. When nothing is waiting, it says so. A signed cheque stays on screen with its result. | Purchase id and status. |

<p align="center"><img src="assets/ag-cheque.jpg" alt="The Waiting for your signature widget: a cheque to SoundHouse for $189.00, with the amount in words, what the owner asked for, why it needs her, and the Sign and pay and Decline buttons" width="420"></p>

The cheque is the same one the auditor agent can put in front of the owner in the chat (below), so the dashboard and the assistant agree on what a waiting purchase looks like and what a click does. Neither the widget nor the agent can approve anything: only the owner's click calls Minder's decision endpoint, which captures or voids the PayPal authorization.

<p align="center"><img src="assets/ag-tricks-caught.jpg" alt="The Tricks caught page: the quote wall of hidden notes, each stamped Blocked, next to a bar chart of which check settled each purchase" width="100%"></p>

The same money-flow widget is reused with different stages: on the *Recovery* page it shows only what happened at checkout and where the money is now.

<p align="center"><img src="assets/ag-recovery.jpg" alt="The Recovery page: KPI tiles, a two-stage money flow from checkout to where the money is now, and the table of recovery cases" width="100%"></p>

Because the widget describes itself to Studio's agents, the AI uses it on its own. Asked to *"Add a money flow widget from each store to where the money is now"*, Studio's page and widget agents added this one, mapped from store to where the money is now:

<p align="center"><img src="assets/ag-ai-built-flow.jpg" alt="A money-flow widget added by the AI assistant, from each store to where the money is now" width="100%"></p>

A horizontal sankey needs room for its labels. When the widget is too narrow, it re-lays itself out as a stack of breakdowns, one per stage, read top to bottom:

<p align="center"><img src="assets/ag-phone-flow.jpg" alt="On a phone, the money flow becomes a stack of breakdowns: which check, at checkout, and where it is now" width="320"></p>

## The data model

[`data.ts`](../src/components/studio/data.ts) gives Studio nine tables, built from the same purchase log as the rest of the app ([`dashboard-data.ts`](../src/lib/dashboard-data.ts), unit tested):

- **Purchases**, one row per purchase the agent tried to make, and six tables tied back to it: **items**, **money flow** (where each dollar went), **store tricks** (what a page told the agent), **recovery cases**, **case steps** (each tied to its case), and **receipts**, Minder's [signed receipt book](RECEIPTS.md) for those purchases, in order, with each receipt's fingerprint. These many-to-one relationships are what let one filter or one click narrow every widget, across tables.
- Two summary tables: **Minder's calls** (approved, asked you, blocked) and the owner's **budget**.
- A calculated measure, **Share kept safe**: money kept safe divided by everything the agent asked to pay.
- Wherever a field's name is not enough, it carries a plain description ("The layer that settled it: Code limits, AI review, Your signature, or Passed every check"), so Studio's agents pick the right one.

## The theme

[`theme.ts`](../src/components/studio/theme.ts) builds on `studioTheme.withParams`, so the dashboard reads as part of Minder rather than an embed. The canvas is the page's own background, with no frame and no shadow, and widgets sit on it like slips. Type is IBM Plex, as in the rest of the app. The chart palette starts with Minder's verdict colours (green for approved, amber for asked you, red for blocked), then quiet neutrals; the filter buttons use Minder's ink when selected. There is one theme for desktop and one for phones.

## Our agents on Studio's Agent Framework

[`agents.ts`](../src/components/studio/agents.ts) keeps Studio's built-in lead, data, page, widget and planning agents, and adds two of ours. The lead is Studio's own, told about the newcomers and allowed to delegate to them.

| Agent | Tools | What it does |
|---|---|---|
| **Purchase auditor** | `look_up_purchase`, `verify_with_paypal`, `prepare_approval` | Finds purchases and explains every decision. Checks Minder's record against PayPal's own: the order, the receipt fingerprint Minder wrote on it, the money held or captured, any refund and any dispute. Can put a purchase that is waiting for the owner in front of them as a cheque with **Sign and pay** and **Decline**. Only the owner's click moves money; the agent cannot. |
| **Rules advisor** | `simulate_rules` | Answers "what if my food budget were $15?" by replaying every past purchase through Minder's real rules code. It never changes the rules. |

Each tool has its own card in the chat ([`ToolCards.tsx`](../src/components/studio/ToolCards.tsx)): a purchase slip, a Minder-versus-PayPal check, a what-if table, and the cheque.

The agents run on Studio's `directLlmRunner` with our own `AgLlmAdapter` ([`studio-adapter.ts`](../src/lib/studio-adapter.ts)). It forwards each turn to Minder's server ([`/api/studio-llm`](../src/app/api/studio-llm/route.ts)), which calls DeepSeek with function calling, with Gemini as a fallback, so no AI key ever reaches the browser.

## AG Studio features used

| Feature | API | Where |
|---|---|---|
| Report, pages and saved state | `AgStudio`, `initialState` (pages, `widgetLayout`), `getState` / `setState`, `onStateUpdated` | [`SpendDashboard.tsx`](../src/components/SpendDashboard.tsx), [`dashboard-layout.json`](../src/lib/dashboard-layout.json): three pages, our own tabs kept in step with pages the AI adds |
| View and edit modes, panels | `mode`, `panels` | *Customize with AI* switches to edit mode; the Compose and Data panels start folded so the report keeps room next to the assistant |
| Layout per device | `widgetLayout` tracks, recomputed for phones | A single-column phone layout with heights per widget type, and a phone theme |
| Theme | `studioTheme.withParams` | [`theme.ts`](../src/components/studio/theme.ts) |
| Custom widgets | `createWidgets` (React), `additionalTypes`, `menu`, `dataMapping`, `form` / `createDefaults`, `formatShape` with `defineAiCommand`, `ai` metadata, `featureConfig.crossFilter` | [`widgets.ts`](../src/components/studio/widgets.ts) |
| Widget data and states | `widgetApi.getData`, `formatFieldValue`, `setDisplayState` (loading, no data, incomplete mapping) | All three custom widgets |
| Cross-filtering | `toggleCrossFilter`, `getCrossFilterSelections` | Money flow blocks and store quotes |
| Filter widgets | `button-filter`, with Minder's styles for default and selected items | *Minder's call* and *Store* on the Overview |
| Relational data and a measure | `sources` with `fields`, `relationships` (many-to-one), `expressions` with `isMeasure` | [`data.ts`](../src/components/studio/data.ts) |
| Formatting | `currencyFormat`, `dateTimeFormat`, `percentageFormat`, `formatOptions` | [`data.ts`](../src/components/studio/data.ts) |
| Built-in widgets | `value`, `linear-gauge`, `donut-chart`, `bar-chart-grouped`, `grid` | All three pages |
| Export | The grid's CSV export and the charts' image download, from the widget toolbar | Every grid and chart |
| Agent Framework | `AgStudioAiModule`, `createAiHarness`, `directLlmRunner`, built-in agents, `tools.delegateTo`, `promptStarters` | [`agents.ts`](../src/components/studio/agents.ts) |
| Custom tools and their cards | `defineAiTool`, `ctx.success` / `ctx.error`, `aiToolDisplay` with `label` and `detail` | [`agents.ts`](../src/components/studio/agents.ts), [`ToolCards.tsx`](../src/components/studio/ToolCards.tsx) |
| Provider adapter | `AgLlmAdapter.executeTurn`, AG-UI events, `stream` / `complete` | [`studio-adapter.ts`](../src/lib/studio-adapter.ts), [`/api/studio-llm`](../src/app/api/studio-llm/route.ts) |

## Tests

- [`dashboard-layout.test.ts`](../src/lib/tests/dashboard-layout.test.ts) checks the saved report against the data model in code: every mapped field exists, every widget type is Studio's or ours, every widget sits on the 24-column grid without overlapping another, the detail tables all link back to purchases, and every money-flow, trick and case row has a purchase to link to. A typo in the layout would otherwise show up only as an empty widget on the live site.
- [`dashboard-data.test.ts`](../src/lib/tests/dashboard-data.test.ts) checks the numbers the tables carry, and [`studio-tools.test.ts`](../src/lib/tests/studio-tools.test.ts) the agents' tools.
- They run with the rest of the unit tests in CI on every push.

## Files

| File | What it holds |
|---|---|
| [`SpendDashboard.tsx`](../src/components/SpendDashboard.tsx) | The Studio component: view and edit modes, the saved and restored layout, live refresh, desktop and phone layouts |
| [`dashboard-layout.json`](../src/lib/dashboard-layout.json) | The default report: pages, widgets and where they sit |
| [`studio/widgets.ts`](../src/components/studio/widgets.ts) | The three widget types: data mapping, forms, format shapes, AI descriptions, menu |
| [`studio/MoneyFlowWidget.tsx`](../src/components/studio/MoneyFlowWidget.tsx), [`studio/StoreTricksWidget.tsx`](../src/components/studio/StoreTricksWidget.tsx), [`studio/ChequesWidget.tsx`](../src/components/studio/ChequesWidget.tsx) | The widgets themselves |
| [`studio/data.ts`](../src/components/studio/data.ts) | Tables, relationships and the calculated measure |
| [`studio/theme.ts`](../src/components/studio/theme.ts) | Minder's theme for Studio |
| [`studio/agents.ts`](../src/components/studio/agents.ts), [`studio/ToolCards.tsx`](../src/components/studio/ToolCards.tsx) | Our agents, their tools, their cards in the chat, and the cheque |
| [`lib/studio-tools.ts`](../src/lib/studio-tools.ts), [`app/api/studio/`](../src/app/api/studio) | The server side of the tools: purchase lookup, the PayPal check, the rules replay |
