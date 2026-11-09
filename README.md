<p align="center">
  <img src="docs/assets/fred-logo.png" alt="Fred" width="360">
</p>

<h3 align="center">An AI Wilderness App — bringing the power of LLMs outdoors</h3>

<p align="center">
  CS-195 Senior Seminar · Fall 2026 · Ryan Magnuson<br>
  <sub>Project proposal v1.2 (final), submitted 9/27/2026</sub>
</p>

---

> **📊 [Current metrics](docs/METRICS.md)** — milestone scorecard, accuracy over
> time, response time and corpora, in one place. Generated from
> `docs/metrics.json` by `npm run metrics`.

## Contents

1. [Project & Course Information](#01--project--course-information)
2. [Overview & Problem](#02--overview--problem)
3. [Functional Requirements](#03--functional-requirements)
4. [Technical Design & Quality](#04--technical-design--quality)
5. [Evidence & Justification](#05--evidence--justification)
6. [Mission & Milestone OKRs](#06--mission--milestone-okrs)
7. [Milestone Grading Criteria](#07--milestone-grading-criteria)
8. [References & Acknowledgments](#08--references--acknowledgments)
9. [Development](#development)

---

## 01 · Project & Course Information

| | |
|---|---|
| **Project title** | Fred |
| **Author** | Ryan Magnuson |
| **Course** | CS-195 Senior Seminar |
| **Term** | Fall 2026 |
| **Instructor** | Mike Ryu |
| **Submitted** | 9/27/2026 |
| **Version** | v1.2 — Final Submission |

**Artifacts:** [Core repository](https://github.com/r-magnus/fred) · [Project board](https://github.com/users/r-magnus/projects/1) · CS-195 Project Proposal Draft

---

## 02 · Overview & Problem

### Overview

When out in the wilderness, questions can arise. Oftentimes, the wilderness supplies
few answers to these questions; "Where am I?" "How do I start a fire?" "I cut myself,
what do I do?" are met with deaf ears, like a tree falling in a forest. Fred is for
people with questions with no other way to ask them. The great outdoors frequently has
spotty-at-best connection to WiFi, data, and the rest of the modern world, so Fred
lives on-device as a stand-in AI guru, assisting in survival know-how and identifying a
user's last known whereabouts. In other words, Fred is a security anchor for the
less-travelled adventurer, for the explorer who accidentally wandered off the trail,
for the thrill-seeker hiker who just twisted an ankle. Fred doesn't replace human best
judgement and reasoning, but instead provides additional counsel when a question arises
that fails to be otherwise answered.

Fred will have access to wildlife, plantlife, and first aid knowledge corpora, track
your location until connection is lost, show a local map of the surrounding area of a
user's last known location, and even point out possible locations to visit to regain
connection — all offline.

### Motivation

**Personal interest.** Starting out on the project brainstorming process, I decided to
make sure whatever project I ended up choosing should be one that leverages local LLMs,
because of how written-off a technology it is. Of course, local LLMs aren't dismissed
for no good reason: relative to an enterprise model, they perform as a child would. To
me, that meant I had to find a vertical where using an enterprise model wasn't an
option. Where are you most cut off from the Internet of Things? The great outdoors.
Things began clicking: running a model on my phone.

The true personal investment clicked soon after for me. My grandfather, Fred James, passed
away a few years ago. He served 45 years as part of the USDA Forest Service — I still
remember visiting his home in Wisconsin, seeing the maps he made on the walls and the
topographical software running on his ancient computer. I called his daughter, my
mother, about this idea — she really liked it.

**Evidence others care.** To prove I wasn't blind firing into the sky with this idea, I
looked in two places: my immediate social circles, and the Internet. Online, I looked
at similar projects, of which there were a handful: Survia, NOMAD, SurvivorAI, to name a
few. This means people are thinking about this pain point, and I think I can do a
better job at addressing it. Furthermore, I talked to the people around me: outdoorsy
types, shut-ins, even EMTs. Even after a three to four minute rundown, they saw the
value. The EMT thought even further, realizing he could use it during rescues without
signal, to help find a nearby location to regain connection and make a call.

### Problem Statement

| | |
|---|---|
| **Who** | Rowdy College Student Hiking Group |
| **Context** | On a hiking trail with no signal, where one particularly excited student ends up badly twisting an ankle. |
| **How it's handled today** | The students rally, put their heads together, and try to help out their fallen comrade by hefting them up and carrying them. One student runs around wildly to try to get service on their phone, to call for help. They slowly make their way back out of the trail. |
| **What's still hard** | • The students did not consider what the best immediate form of treatment should be.<br>• The students had no way to make a call besides hoping to get lucky.<br>• The students only had each other as resources to rely on — if the group doesn't know something, they can't answer what they don't know. |
| **Evidence** | The above fictional example anecdote mirrors experiences happening today. Westmont College is a small Christian liberal arts school in Santa Barbara, CA, with many surrounding hiking trails. In 2024, a nameless student attending Westmont broke his ankle near the top of the trail and was escorted back down the trail by two other students, until they luckily found signal and were able to call for assistance. If they had not found signal, they would have had to escort the injured peer down a rock wall, adjacent to a waterfall, via a single knotted rope. If the students had been better technologically equipped on their adventures, they would have had a greater number of available options to solve their problems. |

### Proposed Solution

Fred effectively serves as a means to provide information to the uncertain user. In an
emergency situation, instead of having absolutely nothing, the user has the ability to
glean relevant information on their situation from Fred. To boil it down, Fred is a
"Survival Info FAQ" book that users talk to regarding their exact situation.

| Problem | Solution |
|---|---|
| User has a first-aid level injury | The user is empowered by a RAG-fueled LLM with a USA military first aid knowledge corpus that can answer their questions. |
| User doesn't know what wildlife they might find in their surrounding area | Based on the user's last known location, the LLM can supply known regional wild and plant life to the user. |
| User is lost, without signal | The app provides a map of the local area, and suggests a landmark that might allow the user to regain signal. |

### Scope

| Core — committed by RC | Stretch — after core | Out of scope |
|---|---|---|
| RAG-empowered local LLM that accurately and coherently answers relevant questions. | The product website is up-and-running. | Voice & photo input functionality. |
| Last-known location tracking, pairing with local map functionality. | Based on last known location, predict where signal might be regained nearby. | General purpose LLM capabilities (i.e. an "all rounder" model). |
| Simple & polished app experience, available on GitHub. | The app is published to Google Play and Apple App Stores. | Folding a user's laundry while pouring a cup of coffee. |
| | LLM confidence layer that rejects responses that the LLM lacks information on. | |

---

## 03 · Functional Requirements

### Core Stories

| ID | Story | Priority | Milestone |
|---|---|---|---|
| [US-01](#us-01--ask-about-surrounding-fauna-and-flora) | Ask about surrounding fauna and flora | Core | Alpha |
| [US-02](#us-02--ask-first-aid-questions-when-hurt) | Ask first-aid questions when hurt | Core | Alpha |
| [US-03](#us-03--see-cited-sources-on-llm-responses) | See cited sources on LLM responses | Core | Alpha |
| [US-04](#us-04--be-told-when-the-llm-does-not-know) | Be told when the LLM does not know | Stretch | RC |
| [US-05](#us-05--learn-rough-estimate-location-when-out-of-service-range) | Learn rough-estimate location when out of service range | Core | Beta |
| [US-06](#us-06--get-directions-on-how-to-regain-signal) | Get directions on how to regain signal | Stretch | RC |
| [US-07](#us-07--stop-an-in-progress-response) | Stop an in-progress response | Core | Beta |
| [US-08](#us-08--ask-about-camping-essentials) | Ask about camping essentials | Core | Alpha |
| [US-09](#us-09--learn-about-fred-and-his-existence) | Learn about Fred and his existence | Stretch | RC |
| [US-10](#us-10--re-read-previous-conversations) | Re-read previous conversations | Core | RC |
| [US-11](#us-11--respond-under-poor-hardware-conditions) | Respond under poor hardware conditions | Core | Beta |
| [US-12](#us-12--learn-how-to-build-a-shelter) | Learn how to build a shelter | Core | Beta |
| [US-13](#us-13--view-battery-consumption) | View battery consumption | Stretch | RC |

#### US-01 · Ask about surrounding fauna and flora

> As a hiker unfamiliar with local fauna and flora, I want to ask about species in the
> state I'm currently in, so that I can determine my level of general safety.

**Priority** Core · **Milestone** Alpha · **Depends on** LLM RAG Corpora Functionality

**US-01-AC1 — Fauna and flora inquiry**
- **Given** the user is in Oregon
- **When** the user makes a query along the lines of: "What plants and animals are near me?"
- **Then** the LLM cites the Oregon knowledge corpus in its response, detailing Oregon's flora and fauna.

#### US-02 · Ask first-aid questions when hurt

> As an outdoorsman or outdoorswoman, I want to ask about how best to treat a cut in the
> wild, so that I can help myself stay protected against the elements if/when I get hurt.

**Priority** Core · **Milestone** Alpha · **Depends on** LLM RAG Corpora Functionality

**US-02-AC1 — Live first aid question**
- **Given** the user has suffered a minor injury
- **When** the user makes a query along the lines of: "I cut myself on a branch, what should I do?"
- **Then** the LLM responds by citing the downloaded first aid knowledge corpus and supplying an accurate response/process to address the wound per the user's situation.

#### US-03 · See cited sources on LLM responses

> As an outdoorsman or outdoorswoman, I want to see where the information Fred gives me
> is coming from, so that I can make my own judgement call on whether or not to trust
> the LLM, or even read the material myself.

**Priority** Core · **Milestone** Alpha · **Depends on** LLM RAG Corpora Functionality

**US-03-AC1 — View a source**
- **Given** the user has asked a corpora-based question and has received an answer
- **When** the user is wondering whether or not to trust the LLM's response
- **Then** the user can see the LLM's source text and passage referenced for the response.

#### US-04 · Be told when the LLM does not know

> As an impressionable and unknowledgeable individual, I want to be told that Fred is
> unsure of something or simply doesn't know an answer, so that I don't make decisions
> based on LLM hallucinations.

**Priority** Stretch · **Milestone** RC · **Depends on** LLM RAG Corpora Functionality Baseline & Response confidence ratings

**US-04-AC1 — Receive a negative response**
- **Given** a user has little experience in the outdoors
- **When** this user asks a question that Fred does not know the answer to
- **Then** Fred tells the user that he does not know the answer, instead of making an answer up.

#### US-05 · Learn rough-estimate location when out of service range

> As a wanderer or lost hiker, I want to ask Fred where I am, so that I can get my
> bearings, and figure out where I need to go.

**Priority** Core · **Milestone** Beta · **Depends on** Last Known Location Tracking & Local Map System

**US-05-AC1 — Lost, and request to be found**
- **Given** the user is lost, and has no signal or service
- **When** the user asks Fred "where am I?"
- **Then** Fred opens the included local map system in-app, and is generally informed of the user's whereabouts when responding to queries.

#### US-06 · Get directions on how to regain signal

> As a wanderer or lost hiker, I want to ask Fred where I can get signal, so that I can
> search something up or make a call.

**Priority** Stretch · **Milestone** RC · **Depends on** US-05-AC1 Core

**US-06-AC1 — Lost, and request to find service**
- **Given** the user is lost, and has no signal or service
- **When** the user asks Fred "I don't have any service, what should I do?"
- **Then** Fred responds with a map akin to US-05-AC1, with an additional highlighted area for possible service coverage areas.

#### US-07 · Stop an in-progress response

> As a hiker with little remaining battery, I want to stop Fred's responses, so that I
> can save my battery if need be, or ask a more pressing question.

**Priority** Core · **Milestone** Beta · **Depends on** Frontend App Shell Development

**US-07-AC1 — Stop an active request**
- **Given** a user is running low on battery
- **When** the user wants to stop a question Fred is already responding to, to save on battery, so they press the "stop" button in the app
- **Then** Fred halts his active response processes.

#### US-08 · Ask about camping essentials

> As a new camper, I want to ask Fred my camping questions, so that I can supplement my
> lack of experience while camping.

**Priority** Core · **Milestone** Alpha · **Depends on** LLM RAG Corpora Functionality & Per-State Wildlife Knowledge Corpus

**US-08-AC1 — How to start a fire**
- **Given** a user does not know how to start a fire
- **When** the user asks Fred "I have no idea how to start a fire! I have XYZ materials/tools…"
- **Then** Fred gives a step-by-step rundown on how to start a fire.

**US-08-AC2 — How to deal with camp food**
- **Given** a user does not know what to do with their food
- **When** the user asks "I have a cooler with some sandwiches and breakfast sausages in it, can animals get in?"
- **Then** Fred responds in the affirmative, and gives advice on how best to protect the food in the campsite, based on local wildlife.

#### US-09 · Learn about Fred and his existence

> As a curious soul on the Internet, I want to find a wilderness product that answers my
> questions, so that I can be better prepared.

**Priority** Stretch · **Milestone** RC · **Depends on** Product Website Development

**US-09-AC1 — Stumble across Fred**
- **Given** a user-to-be is interested in a wilderness app like Fred
- **When** the user-to-be searches up wilderness apps that might suit their needs
- **Then** the user-to-be finds a Fred product landing page/website that has information about the app available, alongside download information.

#### US-10 · Re-read previous conversations

> As a Fred user, I want to read my old conversations, so that I can remind myself of
> something else I talked about with Fred.

**Priority** Core · **Milestone** RC · **Depends on** Frontend App Development

**US-10-AC1 — Visit a previous conversation**
- **Given** a user forgot something that Fred told them
- **When** they open the Fred app to figure out what the lost information was
- **Then** they can look back on previous conversations to remind themselves about what they forgot.

#### US-11 · Respond under poor hardware conditions

> As a user with a weaker mobile device, I want to still be able to use Fred, so that I
> still have a way to get my questions answered to some degree, if I really need it.

**Priority** Core · **Milestone** Beta · **Depends on** LLM RAG Corpora Functionality & Hardware Optimization

**US-11-AC1 — Using new tech with an old phone**
- **Given** a user has an older generation of mobile device, with weaker hardware (i.e. 2GB RAM)
- **When** the user asks any question to Fred
- **Then** Fred's response is shorter, and still within a reasonable amount of time.

#### US-12 · Learn how to build a shelter

> As a lost hiker, I want to figure out how to build a rudimentary shelter, so that I
> have some cover from the elements, if I need to spend the night outdoors.

**Priority** Core · **Milestone** Beta · **Depends on** LLM RAG Corpora Functionality

**US-12-AC1 — How to build shelter**
- **Given** it's getting late, and a user has decided to set up to spend the night outside
- **When** the user asks "How do I build a shelter?"
- **Then** Fred gives a step-by-step walkthrough on how best to build a simple shelter.

#### US-13 · View battery consumption

> As a user, I want to see roughly how much a particular query might drain my phone's
> battery.

**Priority** Stretch · **Milestone** RC · **Depends on** LLM Benchmarking & per-device hardware analysis

**US-13-AC1 — Asking any question to Fred**
- **Given** a user is typing in a question to send to Fred
- **When** the user has completed their message, but hasn't sent it yet
- **Then** the app displays a rough estimate of expected battery usage per the prompt.

---

## 04 · Technical Design & Quality

### System Diagram

The core behind Fred is a straightforward and lightweight RAG system, arming an
otherwise simpleminded local LLM with reliable information to reference when
responding to the user. Detailed below is the visual summary of this operation,
alongside represented data sources, and how a user might come across this application
in the first place.

**Figure 1 — Full System Diagram**

```mermaid
flowchart TB
  subgraph product["Product Page"]
    gh["GitHub<br/>source code"] -- auto-deploys --> vercel["Vercel<br/>product web page"]
  end

  vercel -. app download link .-> user(["User"])

  subgraph install["On-Install Data Downloads"]
    sources["Public Data Sources<br/>WHO BEC · US Army ATP 4-02.11 / 3-50.21 · FM 21-76 · USFS FEIS · FCC BDC"] -- download --> prep["Data Prep Scripts<br/>Node.js + TypeScript<br/>clean · chunk · embed · pack"]
    cards["Field Cards<br/>plain-language steps,<br/>quoted from the manuals"] --> prep
  end

  subgraph phone["On-Phone Processes"]
    ui["App Interface<br/>React Native + TypeScript"]
    rag["RAG Engine<br/>intent · search · gate · prompt"]
    emb["EmbeddingGemma-300M<br/>via llama.rn"]
    db[("Knowledge Packs<br/>SQLite passages + INT8 vectors")]
    llm["Qwen3-1.7B Q4_K_M<br/>via llama.rn"]

    ui -- question text --> rag
    rag -- answer, field card or decline + citations --> ui
    rag -- question --> emb
    emb -- meaning vector --> rag
    rag -- vector search --> db
    db -- best-matching passages --> rag
    rag -- question + passages --> llm
    llm -- generated answer --> rag
  end

  user -- asks a question --> ui
  ui -- displays answer --> user
  prep -- pre-indexed db --> db
```

### Walkthrough

For example, a user asks a flora corpus-relevant question:

1. Query: "What does poison ivy look like, and how do I treat the rash?"
2. Question text is sent to RAG core
3. The question is turned into a meaning vector (EmbeddingGemma) and matched against every passage in the installed packs; nothing below the confidence gate is used
4. If a field card clearly matches, it is shown word for word; otherwise a compound prompt (passages and user query) is sent to the local LLM
5. User receives an informed response, with sources (i.e. "USFS FEIS — poison ivy", "WHO BEC")

**Figure 2 — User Walkthrough**

```mermaid
sequenceDiagram
  actor User
  participant FE as React Native Frontend
  participant RAG as RAG Engine
  participant DB as Packs (SQLite + vectors)
  participant LLM as Qwen3-1.7B (llama.rn)

  User->>FE: "What does poison ivy look like, and how do I treat the rash?"
  FE->>RAG: Send question text
  RAG->>DB: Meaning search (EmbeddingGemma vector)
  DB-->>RAG: Top passages
  RAG->>LLM: Compound Prompt (instructions, passages, question)
  LLM-->>RAG: Streamed answer tokens
  RAG-->>FE: Answer + source citations
  FE-->>User: Returned answer & sources ("USFS FEIS, WHO BEC")
```

### Components & Choices

| Component | Choice | Why it fits | Alternatives · tradeoffs |
|---|---|---|---|
| Frontend / UI | React Native | Android & iOS compatibility, plus sleek component-based design system. | Flutter/Dart; I have no experience with this technology. |
| Backend & processing | Serverless LLM RAG core | This is the point of the project. | Pursue a different project. |
| Data · model · DBMS | SQLite packs with INT8 vectors · EmbeddingGemma-300M (search) · Qwen3-1.7B Q4_K_M (answers) · WHO BEC · US Army ATP 4-02.11 & 3-50.21 · FM 21-76 (signalling) · USFS FEIS (per state) · FCC BDC (coverage) · reviewed field cards | Searching by meaning finds passages for plainly worded questions that keyword search missed; Qwen3-1.7B is the smallest model that answered accurately; field cards give instant, reviewed steps for common emergencies. | Keyword search (SQLite FTS5) and Qwen3-0.6B, the original design: both measured lower (`docs/results-phase1.md`, `docs/METRICS.md`). A larger model (Qwen3-4B) is not yet measured; phone memory and speed are the limit. |
| Languages · frameworks · APIs · hardware | TypeScript · Node.js · llama.rn (search and answers) · op-sqlite | One runtime on the phone for both models; the desktop harness runs the same pipeline code on node-llama-cpp, and every pack is checked for matching vectors at load. | ONNX Runtime for search, used before EmbeddingGemma (`docs/results-m3.md`). |
| Hosting & deployment | Vercel for product page | Vercel links directly into GitHub, making development easy. | ngrok hosting. |
| Auth · permissions · sensitive data | Authless experience, all data stays on-device. | Login processes add unneeded friction when all app information is stored locally, and meant to be used offline. | If needed, set up a simple server machine for auth purposes. Greater friction and overhead. |
| User feedback | Run trial and focus groups with Fred. | This permits receiving real world user feedback while a proper feedback system on-app is pending. | On-app review system while online. |
| Testing & evaluation | Claude Opus 5 & local LLM accuracy evaluation | This allows a smarter enterprise model to evaluate the performance of Fred, armed with a Q&A test with marked correct answers. | Online model performance benchmarking websites. |

### Quality Requirements

| ID | Attribute | Target | Verification |
|---|---|---|---|
| QR-01 | Response Time | < 30 s | Over a series of RAG-empowered user queries, time each response and measure the average, on a mobile device with 6+ GB RAM. |
| QR-02 | Semantic Response Accuracy | > 80% | Give an enterprise model a test to administer to Fred, alongside an answer sheet. Compare Fred's outputs to the expected answers, determine if an answer is acceptable or not, and compare correct to incorrect responses. This evaluation is semantic in the sense of evaluating like a real user would: ask a question in a natural way, and receive an answer accurate to the user's specific request, in an evenly natural way. |

---

## 05 · Evidence & Justification

### Alternatives

| Alternative | How it runs | Response confidence | Location tracking | Data sources |
|---|---|---|---|---|
| Manual Workflow | Slow and heavy paper pamphlets and books | Up to the reader's interpretation of the text; no clarifying questions | Good luck with your paper map from several years ago. | Whatever gift shop you wandered into. |
| Prepper AI | On-Device | Not stated. | Rudimentary offline maps | Reputable books (TCCC, FEMA); no citations. |
| SurvivorAI | Unreleased app | Colored answer confidence label | Rudimentary offline maps | 228 named sources and citations. |
| SURVIA | 6GB+ RAM iPhone Beta | Cautious about plant consumption | Maps and GPS | 6.34GB local library; no named sources or citations. |
| Project NOMAD | Self-hosted server, non-portable | Not stated. | Rudimentary offline maps | Wikipedia and self-uploaded content. |
| **Fred** | **On-Device, low memory consumption** | **Halts when providing an unsupported answer.** | **Offline maps with location and service prediction** | **Lightweight and curated set of corpora, with citations.** |

### Market Overview

| | |
|---|---|
| **Done well** | Bare-bones LLMs, with simple offline maps. |
| **Unmet need** | A complete package experience of a fast local LLM paired with location tracking, all offline. |
| **Why it's substantial** | The difference is in user experience, and in practicality. Fred will be able to serve quickly-digestible answers alongside the original source to better answer user queries, as well as track user location to the best of his ability, making Fred a wilderness no-brainer draft pick. |

### Feasibility

**Available time:** ~15 hrs/week × 4 × 4 months to RC → ~240 hrs

| Milestone | Date | Stories | Deliverables | Test · revision |
|---|---|---|---|---|
| Alpha | 10/19/2026 | US-01→04, US-08, US-11→12 | LLM RAG system is functional and accurate, with corpora. | Compare Fred's outputs with an enterprise model to grade and score accuracy. |
| Beta | 11/16/2026 | US-05 | Local map systems are functional; service assistance is available. | Physically relocate to different locations to determine accuracy & usefulness. |
| RC | 12/9/2026 | US-07, US-10 | The frontend is finalized, and users can download the app. | Open website on both iOS and Android and attempt to download. |

### Risks

| ID | Assumption at risk | Likely effect | Investigate · when | Fallback |
|---|---|---|---|---|
| R-01 | The LLM RAG system does not produce accurate responses. | The project's scope becomes dramatically reduced. | ASAP, Sprint 0. | Proceed to conversations with instructor Mike Ryu on how to pivot. |
| R-02 | The multitude of knowledge corpora make the app obscenely large. | Users are disinterested in the product due to its storage greediness. | Beta Release | Consider alternative strategies, such as having the user pick and choose what to download. |
| R-03 | The local map + service assistance systems are non-functional. | The app's practicality and use takes a hit. | Beta Release | Consider alternative solutions, such as GPS or radio. |

### Cost

| Item | Price | Usage assumption | Free-tier limit | Estimate | Fallback |
|---|---|---|---|---|---|
| Claude Code | $20/Month | Maximal Session Usage | Unhelpful, non-option. | $60 | Gemini Pro Student Subscription |
| iOS App Store Publication | $100, One-Time | Provide an official download | Nonexistent. | $100 | Provide download via product website + GitHub |
| Domain Name | ~$12/Year | A couple years | Unhelpful, non-option. | ~$25 | Simply use GitHub as a rudimentary landing page. |
| Vercel | Free Tier | Light activity & web traffic | 100GB data, 1M user requests | $0 | ngrok hosting |

### Broader Constraints

| Constraint | Consideration | Effect on scope · design |
|---|---|---|
| Licensing & Data permissions | Knowledge Corpora | Be conscious of what data sources used for RAG corpora. See [`docs/licensing.md`](docs/licensing.md). |
| Privacy | Personal User Input & Info | Fred won't track any personal data — we're not Meta. |
| Accessibility | Price & Platform | Fred will be free-to-use, on a donation income model. Available on iOS & Android. |
| Social Impact | How people would otherwise handle a problem together in the wilderness | Fred isn't here to redefine how people work together in the wild, but instead help them make informed decisions, together. |

### Impact

| | |
|---|---|
| **Stakeholders** | Directly affected are those who would use Fred themselves. Assuming that Fred proves to be effective — used by many, in genuinely helpful contexts — Fred would redefine decision making in the wild. Thus, indirectly affected are those who might have a friend with Fred on their phone, with Fred's input steering their conversations. |
| **Power to** | The goal of Fred is to empower the not-so enlightened adventurers — that is to say, people who might not know what they're doing in the great outdoors and need a helping hand. Instead of just using a "best guess" in a survival scenario, a user has a little extra information to make an informed decision on. |
| **Power over** | A simple case is where a user asks Fred a question, and argues their perspective in a survival dispute using Fred as argumentative ammunition. Fred isn't meant to tell others that they are wrong, but merely tune into conversation to assist groups in making informed decisions together. While that is the intention, it's not the only possibility. |
| **What changes** | I think there's something very special about little things in life. With intention, Fred isn't meant to replace anything — things as simple as tiny pocket survival FAQ handbooks lining gift shop walls hold advice tailored by the person who wrote them. Such a thing is human, and such a thing is special. Fred could jeopardize these little things, if the project proves to be widely accepted. |
| **Drawbacks** | Should the previous thoughts come to reality, and Fred becomes the global go-to wilderness guru, technology is woven deeper into places it was not already. That is to say, Fred is bringing tech even further outdoors. This is worthy of lament. It's a very human thing to "take over" our world with our own creations, and that variety of behavior can be more destructive than not. Even as a software developer I believe we don't need more technology, but less. That all said, Fred offers a service that could transform how people exist in the natural world, making them safer and smarter for it. |
| **Meta reflection** | Despite this reflection, little changes in terms of technologies to be implemented. Fred still holds the same goals as stated in this document. This reflection may however necessitate conversation with prospective users or test users to reveal dangers or weak points of Fred's design philosophy before a fully-sent launch. |

---

## 06 · Mission & Milestone OKRs

> **Mission:** Empower anyone to confidently wander throughout the natural world.

### Alpha — 10/19/2026

**Objective:** Local LLM RAG system is functional and accurate, with necessary corpora.

| ID | Result | Measurement | Target · deadline | Verification | Connects to |
|---|---|---|---|---|---|
| A-KR1 | Fred can make informed responses based off his knowledge corpora | The following corpora are all accounted for: First Aid · Per-state flora & fauna · Survival skills | 9/18/2026 | When asked a corpora-relevant question, Fred uses RAG on the proper material. | US-01→04, US-08, US-11→12 |
| A-KR2 | Fred's responses are useful and accurate | > 70% LLM accuracy in all corpora-related questions | 10/12/2026 | Test Fred's inputs/outputs against an enterprise model armed with an answer sheet | US-01→04, US-08, US-11→12 |
| A-KR3 | Fred's responses are quick and timely | < 20 s LLM response time, per query | 10/19/2026 | Run a series of queries, timing each response. | US-01→04, US-08, US-11→12 |

### Beta — 11/16/2026 *(revised 11/7/2026)*

**Objective:** The Fred application can help a user find signal, without any signal in
the first place, and does so in a way that either conserves battery or makes the user
mindful of it.

| ID | Result | Measurement | Target · deadline | Verification | Connects to |
|---|---|---|---|---|---|
| B-KR1 | The Fred application can direct a user to signal. | From 6+ starts in dead zones, following Fred's direction reaches signal in at least 4. | 10/26/2026 | Drive to different physical locations without signal, and follow directions given by Fred. | US-05 |
| B-KR2 | Fred's coverage map predicts real signal well enough to act on. | At 12+ checkpoints, at least 4 of which in no-service zones, are accurate to ~80%+ of real signal bars. | 11/10/2026 | Per checkpoint, screenshot the phone's signal bars next to Fred's in-app map display, noting discrepancies. | US-05 |
| B-KR3 | The phone can maintain power for an average day hike, with the Fred app in frequent use. | On a ~5,000 mAh mobile battery, Fred + tracking lasts a ~6 hour hike. | 11/16/2026 | Across multiple tests, begin at 100% battery + tracking on, logging battery usage. | US-05 |

### Release Candidate — 12/9/2026 *(revised 11/7/2026)*

**Objective:** Users have Fred in their hands, as a packaged MVP, fully functional in
intended no-WiFi environments, ready to run on private phones as "the real deal."

| ID | Result | Measurement | Target · deadline | Verification | Connects to |
|---|---|---|---|---|---|
| RC-KR1 | Users who download Fred go through the setup funnel: downloading their area's information. | ~80%+ of (loosely) invited testers with qualifying phones finish setup, post large download. | 11/25/2026 | Send out invitations to local acquaintances; of the testers who complete initial download, mark how many finish setup. | US-09, US-10 |
| RC-KR2 | Fred is positively received, with indication of further future and practical use, in the real world. | ~70%+ of test users say they'd bring Fred out on their next hike. | 12/2/2026 | Conduct a survey (either in-app, through a mailing list, or in person) recording personal sentiments and reviews from testers. | US-09, US-10 |
| RC-KR3 | Fred is a successful application and project within the immediate community and beyond. | Fred has an active userbase of >500 hikers\* who use the Fred app on a semi-recursive basis. | 12/9/2026 | When in-signal, send records of which users still have Fred downloaded on their phone after initial first-time use. | US-09, US-10 |

\*The term "hikers" serves as a nickname, referring to the would-be real user base of the Fred app.

**Why the revision**
- **B-KRn** — These have to do with practical user use cases, and how well things
  actually perform on a real phone. The prior KRs were a little too loosey-goosey.
- **RC-KRn** — These have to do with test/real user interaction with the Fred app: are
  they downloading it, saying they like it, keeping it in the long run? The prior KRs
  weren't specific or helpful enough.

<details>
<summary>Beta and Release Candidate KRs as submitted in v1.2 (9/27/2026), superseded</summary>

#### Beta — 11/16/2026

**Objective:** The application tracks the user's last known location, for the purposes
of serving maps of the surrounding location, and providing suggestions on how to find
service.

| ID | Result | Measurement | Target · deadline | Verification | Connects to |
|---|---|---|---|---|---|
| B-KR1 | While in service, Fred is aware of a user's location. | When running, the app can retrieve a user's location, and serve it to both the LLM and user. | 10/26/2026 | Drive to different physical locations and run the estimation program, WiFi on. | US-05 |
| B-KR2 | Fred can make the connection between a user's location and their queries. | When prompted, the recorded location of the user directs Fred's responses to become tailored to the specific user. | 11/10/2026 | Drive to different physical locations and run the estimation program, WiFi off, and ask questions. | US-05 |
| B-KR3 | Fred can provide suggestions on where to go to find service. | The user can access a map with the estimated location zone alongside a shaded "possible service" region, within a several-km perimeter around the user. | 11/16/2026 | Drive to different physical locations and run the estimation program, WiFi off. Test service accuracy in and out of zones. | US-05 |

#### Release Candidate — 12/9/2026

**Objective:** Users have Fred in their hands, as a packaged MVP, fully functional in
intended no-WiFi environments. Fred additionally has a public product page & website,
with downloads available for an iOS & Android frontend application.

| ID | Result | Measurement | Target · deadline | Verification | Connects to |
|---|---|---|---|---|---|
| RC-KR1 | Fred is available as an app, compatible with both iOS and Android. | Both Android and iOS users can download and properly use Fred. | 11/25/2026 | Test on both Android and iOS, from discovery to download to use. | US-09, US-10 |
| RC-KR2 | Fred has been user-tested and is live in the hands of a population of users. | Fred has a user base of at least 10 individuals across both iOS and Android. | 12/2/2026 | Outsource a testing population of peers and colleagues to collect qualitative review. | US-09, US-10 |
| RC-KR3 | Fred has a product page, including professional promotional material. | Displayed on-page are at least 3 videos and 8 images of Fred use and content. | 12/9/2026 | Navigate through the site as an external user, and forward the site to non-stakeholders. | US-09, US-10 |

</details>


---

## 07 · Milestone Grading Criteria

*Revised 11/7/2026.* ↑ higher is better · ↓ lower is better

| KR | Metric & evidence | A | B | C | D | F |
|---|---|---|---|---|---|---|
| A-KR1 | Necessary Knowledge Corpora | All listed corpora are functional. | ~75% of listed corpora; core functional. | Core corpora only. | Some load, but other corpora are missing. | None loading, or otherwise failing. |
| A-KR2 | Accuracy ↑ | > 80% | 79–60% | 59–50% | 49–30% | < 30% |
| A-KR3 | Response Time ↓ | < 20 s | 20–40 s | ~2 m | ~5 m | > 5 m |
| B-KR1 | Signal Mapping ↑ | 4/6 | 3/6 | 2/6 | 1/6 | 0/6 |
| B-KR2 | LLM & Location ↑ | > 80% | 70–79% | 60–69% | 40–59% | < 40% |
| B-KR3 | Battery Mileage ↑ | > 6 hrs | 5–6 hrs | 4–5 hrs | 3–4 hrs | < 3 hrs |
| RC-KR1 | Tester Setup Funnel ↑ | > 80% | 60–70% | 50–60% | 25–50% | < 25% |
| RC-KR2 | User Sentiment ↑ | > 70% | 50–70% | 40–50% | 20–40% | < 20% |
| RC-KR3 | User Population ↑ | > 500 | 200–500 | 50–200 | 25–50 | < 25 |

**Notes**
- **A-KRn** — Bands are largely unchanged: these KRs had already passed when the OKRs
  were revised. In hindsight, A-KR1 would be better replaced by how often Fred responds,
  balancing his refusal to respond against remaining helpful and cohesive to the user.
- **A-KR1** — Less quantitative, so metrics are described instead of numeric.

<details>
<summary>Grading criteria as submitted in v1.2 (9/27/2026), superseded</summary>

↑ higher is better · ↓ lower is better

| KR | Metric & evidence | A | B | C | D | F |
|---|---|---|---|---|---|---|
| A-KR1 | Necessary Knowledge Corpora | All needed corpora are functional. | Most required corpora are functional. | Bare minimum corpora are functional. | Corpora is missing or non-functional. | The entire RAG-corpora system is non-functional. |
| A-KR2 | Accuracy ↑ | > 80% | 79–60% | 59–50% | 49–30% | < 30% |
| A-KR3 | Response Time ↓ | < 20 s | 20–40 s | ~2 m | ~5 m | > 5 m |
| B-KR1 | User Location | The user's location is known, and can be displayed accurately on-map. | The user's rough location is available via GPS out of service. | The user's rough location is available via GPS in service. | The user's state is known. | Location is completely unknown. |
| B-KR2 | LLM & Location | LLM knows the user's rough location in relation to POIs. | LLM knows the user's rough location. | LLM can be told the user's location. | LLM only knows the user's state. | LLM is entirely separate from location. |
| B-KR3 | Predicted Service Zone Accuracy ↓ | ±2 km | ±5 km | ±7.5 km | ±10 km | > ±10 km |
| RC-KR1 | App Availability | iOS && Android | iOS \|\| Android | App only works on Expo Go (or equivalent) | App exists, but is barely functional. | App is non-existent. |
| RC-KR2 | User Population ↑ | > 10 | 9–5 | 5–2 | 1 | No one is using Fred. |
| RC-KR3 | Product & Promo | 3 videos, 8 images | 1 video, 5 images | 1 video, 2 images | 0 videos, 1 image | Zip, nada, nothing. |

**Notes**
- **A-KR1** — Less quantitative, so metrics are described instead of numeric.
- **RC-KR1** — May be up to debate due to unfamiliarity in this arena.

</details>

---

## 08 · References & Acknowledgments

### Iterations

- **Draft.** Draft Proposal — as submitted 9/12/2026 (v0.5).
- **Final.** v1.2 — submitted 9/27/2026, mirrored in this README.
- **Revised OKRs.** Sections 06B and 07B — 11/7/2026: new Beta and Release Candidate KRs
  and grading bands, shown above; the v1.2 versions are kept beneath them.

### References

1. Vercel Pricing: Hobby, Pro, and Enterprise plans
2. Mermaid | Diagramming and charting tool
3. SURVIA — Offline Survival AI · Bushcraft & Wilderness Help With No Signal
4. Project NOMAD - Offline Knowledge & AI Server
5. Prepper AI - Offline Survival AI
6. SurvivorAI: Offline AI Survival Guide

The retrieval pipeline builds on Kang et al., *PocketRAG: On-Device RAG for First Aid
Guidance in Offline Mobile Environments* — see [`docs/optimizations.md`](docs/optimizations.md).

### Acknowledgments

| Name | Date | Contribution |
|---|---|---|
| Fred James | ~2020 | My inspiration and exigence. |
| Ethan Camp | 9/4/2026 | EMT interview in the overview. |
| Granite\* | ~2024 | Student evidence in the overview. |

\*Last name not provided, for anonymity.

### Templates & AI Use

| | |
|---|---|
| **Template** | Claude: Project Proposal Blank Layout Template · ChatGPT: Cover Page Fred Logo |
| **AI writing assistance** | Claude Opus 5, for grammar, spellcheck, and general legibility. |

---

## Development

### Layout

```
packages/rag-core/     Platform-agnostic retrieval pipeline (TypeScript)
packages/pack-format/  Pack manifest schema + shared types
apps/mobile/           React Native app (Expo dev build)
tools/ingest/          Node: corpus -> chunks -> embeddings -> INT8 -> pack
tools/eval/            Node: ablation harness over MCQ eval sets
docs/                  Design notes, licensing register, results
```

**`rag-core` is deliberately platform-agnostic.** It talks to the world through two
interfaces, `InferenceBackend` and `PackStore` (`packages/rag-core/src/backends.ts`).
The mobile app implements them with `llama.rn` + `op-sqlite`; the eval harness with
`node-llama-cpp` + Node's built-in SQLite. The same pipeline code runs in both, so the
evaluation measures the system that actually ships rather than a reimplementation.

### Develop

Requires Node 22+ (uses native TypeScript execution — no build step for the core).

```bash
npm install
npm test
npm run typecheck
```

### Docs

- [`docs/optimizations.md`](docs/optimizations.md) — PocketRAG technique → implementation,
  and three deliberate deviations
- [`docs/licensing.md`](docs/licensing.md) — source licenses; note the WHO
  NonCommercial constraint
- `docs/results-m0.md` … `docs/results-m3.md` — measured results per milestone
- [`docs/results-alpha.md`](docs/results-alpha.md) — corpora against the proposal's A-KR1
- [`docs/results-nli-research.md`](docs/results-nli-research.md) — whether an NLI
  grounding verifier would fix A-KR2's lost points, and the desktop test to run

Build packs with `node tools/ingest/src/index.ts <who-bec|atp-3-50-21|atp-4-02-11>`
(source PDFs go under `corpora/`, which is not committed). Per-state plant and wildlife
packs come from USFS FEIS: `node tools/ingest/src/feis-fetch.ts` once, then
`node tools/ingest/src/feis-pack.ts CA OR`. Check corpus coverage with
`node tools/eval/src/coverage.ts`.


### Licensing

Copyright © 2026 Ryan Magnuson. All Rights Reserved.

This repository contains proprietary software. No permission is granted
to copy, modify, distribute, sublicense, or commercially exploit this
software without prior written permission from Ryan Magnuson.
