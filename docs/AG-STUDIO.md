# The dashboard, built with AG Studio

Minder's dashboard ([live](https://minder-2hey.onrender.com/dashboard)) is Maya's spending statement: everything her agent tried to buy, what Minder did about each purchase, and where every dollar is now. It is an AG Studio 3.0 report (`ag-studio` and `ag-studio-react` 3.0.0) with three pages, two widget types of our own, a connected data model, Minder's own theme, and two of our AI agents working alongside Studio's.

<p align="center"><img src="assets/ag-overview.jpg" alt="The Overview page: four KPI tiles, Minder's money-flow sankey, a donut of Minder's calls and a bar chart of money paid to each store" width="100%"></p>

## What the owner sees

- **Three pages.** *Overview* (what was spent, what was kept safe, where the money went), *Tricks caught* (what store pages told the agent) and *Recovery* (orders that went wrong after payment, and how the money came back). The tab labels carry live counts.
- **One click filters everything.** Click a block in the money flow, a store in the bar chart or a quote on the *Tricks caught* page, and every widget on the page narrows to it, across tables.
- **Customize with AI.** The button opens Studio's editor with its AI assistant. The prompt starters are the questions an owner actually has: *Why was it blocked?*, *Check with PayPal*, *What if*, *Anything to sign?* and *Money flow by store*.
- **On a phone** the report keeps its content in a single column with its own theme, and editing waits for a larger screen.

## Two widget types of our own

Both are registered with `createWidgets` next to Studio's built-in types, and listed first in the widget menu under *Minder* ([`widgets.ts`](../src/components/studio/widgets.ts)). Each comes with a data mapping, a format shape that Studio validates AI edits against, and a description written for Studio's agents, so the AI can place and configure them like any built-in chart.

| Widget | What it shows | How it is mapped |
|---|---|---|
| **Money flow** ([`MoneyFlowWidget.tsx`](../src/components/studio/MoneyFlowWidget.tsx)) | A sankey of every dollar the agent asked to spend: which check settled it, what happened at checkout, and where the money is now. Ribbons take the colour of where the money ended up: green stayed with the owner, amber is waiting, slate reached a store. | 2 to 5 category fields, in order, as stages, plus an amount. Its own format options: show amounts, show stage names. |
| **What stores told your agent** ([`StoreTricksWidget.tsx`](../src/components/studio/StoreTricksWidget.tsx)) | The exact words store pages hid for AI agents, as the AI review caught them, each stamped with what Minder did. | Quote, store, outcome and order total. |

<p align="center"><img src="assets/ag-tricks-caught.jpg" alt="The Tricks caught page: the quote wall of hidden notes, each stamped Blocked, next to a bar chart of which check settled each purchase" width="100%"></p>

The same money-flow widget is reused with different stages: on the *Recovery* page it shows only what happened at checkout and where the money is now.

<p align="center"><img src="assets/ag-recovery.jpg" alt="The Recovery page: KPI tiles, a two-stage money flow from checkout to where the money is now, and the table of recovery cases" width="100%"></p>

Because the widget describes itself to Studio's agents, the AI can use it unprompted. Asked to *"Add a money flow widget from each store to where the money is now"*, Studio's page and widget agents added this one, mapped from store to where the money is now:

<p align="center"><img src="assets/ag-ai-built-flow.jpg" alt="A money-flow widget added by the AI assistant, from each store to where the money is now" width="100%"></p>

A horizontal sankey needs room for its labels. When the widget is too narrow, it re-lays itself out as a stack of breakdowns, one per stage, read top to bottom:

<p align="center"><img src="assets/ag-phone-flow.jpg" alt="On a phone, the money flow becomes a stack of breakdowns: which check, at checkout, and where it is now" width="320"></p>

## The data model

[`data.ts`](../src/components/studio/data.ts) gives Studio eight tables, built from the same purchase log as the rest of the app ([`dashboard-data.ts`](../src/lib/dashboard-data.ts), unit tested):

- **Purchases**, one row per purchase the agent tried to make, and five tables tied back to it: **items**, **money flow** (where each dollar went), **store tricks** (what a page told the agent), **recovery cases**, and **case steps** (each tied to its case). These many-to-one relationships are what let one click filter every widget, across tables.
- Two summary tables: **Minder's calls** (approved, asked you, blocked) and the owner's **budget**.
- A calculated measure, **Share kept safe**: money kept safe divided by everything the agent asked to pay.
- Wherever a field's name is not enough, it carries a plain description ("The layer that settled it: Code limits, AI review, Your signature, or Passed every check"), so Studio's agents pick the right one.

## The theme

[`theme.ts`](../src/components/studio/theme.ts) builds on `studioTheme.withParams`, so the dashboard reads as part of Minder rather than an embed. The canvas is the page's own background, with no frame and no shadow, and widgets sit on it like slips. Type is IBM Plex, as in the rest of the app. The chart palette starts with Minder's verdict colours (green for approved, amber for asked you, red for blocked), then quiet neutrals. There is one theme for desktop and one for phones.

## Our agents on Studio's Agent Framework

[`agents.ts`](../src/components/studio/agents.ts) keeps Studio's built-in lead, data, page, widget and planning agents, and adds two of ours. The lead is Studio's own, told about the newcomers and allowed to delegate to them.

| Agent | Tools | What it does |
|---|---|---|
| **Purchase auditor** | `look_up_purchase`, `verify_with_paypal`, `prepare_approval` | Finds purchases and explains every decision. Checks Minder's record against PayPal's own: the order, the money held or captured, any refund and any dispute. Can put a purchase that is waiting for the owner in front of them as a cheque with **Sign and pay** and **Decline**. Only the owner's click moves money; the agent cannot. |
| **Rules advisor** | `simulate_rules` | Answers "what if my food budget were $15?" by replaying every past purchase through Minder's real rules code. It never changes the rules. |

Each tool has its own card in the chat ([`ToolCards.tsx`](../src/components/studio/ToolCards.tsx)): a purchase slip, a Minder-versus-PayPal check, a what-if table, and the cheque.

The agents run on Studio's `directLlmRunner` with our own `AgLlmAdapter` ([`studio-adapter.ts`](../src/lib/studio-adapter.ts)). It forwards each turn to Minder's server ([`/api/studio-llm`](../src/app/api/studio-llm/route.ts)), which calls DeepSeek with function calling, with Gemini as a fallback, so no AI key ever reaches the browser.

## Files

| File | What it holds |
|---|---|
| [`SpendDashboard.tsx`](../src/components/SpendDashboard.tsx) | The Studio component: view and edit modes, the saved layout, desktop and phone themes |
| [`studio/widgets.ts`](../src/components/studio/widgets.ts) | The two widget types: data mapping, format shapes, AI descriptions, menu |
| [`studio/MoneyFlowWidget.tsx`](../src/components/studio/MoneyFlowWidget.tsx), [`studio/StoreTricksWidget.tsx`](../src/components/studio/StoreTricksWidget.tsx) | The widgets themselves, with cross-filtering |
| [`studio/data.ts`](../src/components/studio/data.ts) | Tables, relationships and the calculated measure |
| [`studio/theme.ts`](../src/components/studio/theme.ts) | Minder's theme for Studio |
| [`studio/agents.ts`](../src/components/studio/agents.ts), [`studio/ToolCards.tsx`](../src/components/studio/ToolCards.tsx) | Our agents, their tools, and their cards in the chat |
| [`lib/studio-tools.ts`](../src/lib/studio-tools.ts), [`app/api/studio/`](../src/app/api/studio) | The server side of the tools: purchase lookup, the PayPal check, the rules replay |
