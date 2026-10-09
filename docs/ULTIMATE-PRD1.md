# ULTIMATE_PRD: Davos: AI-Powered Life Mentor & Coach

## 1. Executive Summary

**Product Vision:** A hyper-personalized, RAG-driven life coach designed to eliminate the gap between ambition and execution. It replaces generic motivational apps with a proactive, context-aware agent that manages the user's routine, diagnoses behavioral failures, and drives growth using factual "doings" data and psychological tactics.
**Target Audience:** Ambitious, hardworking, zero-background young individuals who are failing to reach their potential, lack human mentors, and actively desire high-friction accountability to stay in their flow state.

## 2. Core Mechanics & Architecture

* **The "Doings" Memory Engine (Main RAG Data):** Continuous ingestion of the user's daily actions. This is the ground truth the AI uses to guide, criticize, and plan.


* **The "Greats" Rules Engine:** Core decision-making is governed by 100+ curated rules from 50+ elite historical figures across 16 life domains. These rules are pre-seeded universal records in the database, requiring no manual setup. The AI cross-references the user's current situation and specific life domain to apply the correct rule (e.g., prioritizing aggressive discipline for career tasks, but empathetic rules for relationship metrics), ensuring no contradictory advice.


* **Dynamic Persona Engine:** The bot acts as a mentor, therapist, brother, or trainer. Persona is selected dynamically:


* *High Confidence:* AI automatically adopts the persona matching the user's detected emotional state.


* *Medium Confidence:* AI presents 2-3 tailored persona options for the user to select.


* *Low Confidence:* AI explicitly prompts the user to define the interaction mode.


* *Classifier Fallback:* If the deterministic classifier cannot resolve the domain or emotional state, the system defaults to a "General" domain and a safe "Inquirer/Therapist" persona to conversationally clarify context.


* *Adaptive Statistical Weighting System:* Confidence thresholds dynamically adjust based on mathematical weights incremented by historical accuracy and decremented by explicit user overrides, replacing standard ML model overhead.





## 3. Feature Specifications

### 3.0. The Mentor Chatbot (Primary UI)

* **Agentic Conversational Interface:** The central hub of the app is not a standard dashboard, but an ongoing, continuous chat thread with Davos. This is where all planning, advice, venting, and interventions happen.


* **Non-LLM Persona Guardrails:** Davos is strictly restricted from acting like a generic, compliant LLM (e.g., no "As an AI..." or standard polite filler). Responses are engineered to be relentlessly human, opinionated, and driven by the user's specific context. This is enforced structurally via Few-Shot Exemplars and JSON Structural Anchoring (e.g., separating internal reasoning from direct verbal delivery), strictly forbidding regex post-processing or retry-loop regenerations.


* **Proactive Engagement:** The chatbot does not wait for prompts. It initiates conversations based on routine deviations, scheduled check-ins, or to fill knowledge gaps about the user's past, mitigating loneliness by acting as an always-present companion.


* **Dynamic Persona Delivery:** Through this single chat interface, Davos fluidly shifts between roles (therapist, tough-love mentor, financial consultant, fitness trainer) based on the current context, altering its tone, vocabulary, and response length accordingly.



### 3.1. Accountability & Time Management

* **Interval Check-ins:** Hourly or bi-hourly prompts ("What did you do this hour?") delivered via a persistent notification or widget. Accepts 1-2 sentence inputs plus a 1-10 numerical or emoji energy rating. Data flows via OS direct reply or deep link directly into the ingestion loop (`doings_logs`) for immediate evaluation. Targets users who consent to high-friction interruptions to maintain focus.


* **Context-Aware Day Planning:** Operates via "Just-in-Time" dynamic blocking rather than a rigid start-of-day calendar. Dynamically structures the user's day and assigns tasks during detected free periods based on overarching goals, routine, and real-time energy scores. Automatically schedules free time and boredom-relief activities. Planned rescheduling strictly requires conversational approval from Davos.


* **Long-Term Foresight & Side Quests:** Dynamically evaluates behavior via background database polling to spot invisible behavioral drifts. Outputs deadline-bound tasks to avoid future consequences. Automatically generates "Side Quests" (e.g., assigning a time-management challenge to a user who is chronically logging late starts), which are integrated into the Life Dashboard via temporary components from the pre-built registry.



### 3.2. Behavioral Rehab & Interception

* **Doomscroll & Impulse Interception:** Operates via a persistent widget/notification. If the user fails an impulse battle, they log the failure. The system uses this temporal data to predict the time/context of future urges and fires preemptive notifications with high-dopamine alternative activities before the habit loop triggers.


* **Bad-Habit Diagnosis (The Strike):** If a user refuses to quit a bad habit, the system silently tracks the behavior for $X$ days. It then executes a Tiered Proof Architecture:


1. **Logged Behavioral Ground Truth:** Hard facts (e.g., timestamps, missed check-ins, doomscroll logs) are treated as undeniable evidence.


2. **Verified Goals:** If the user conversationally verified deadlines/commitments, the Strike connects failure directly to those stated goals.


3. **Unverified Goals:** If the user evaded conversational extraction, the AI attacks based purely on logged behavioral trends and frames long-term consequences as probabilistic risks without hallucinating external constraints.





### 3.3. Give-Up Handling & Psychological Operations

* **The Anti-Quit Protocol:** Triggered when the user attempts to give up or cites false constraints. When triggered, the AI enters a Dialog State Lockdown, restricting topic changes and forcing the confrontation until the user concedes.


* **Fact-Based Confrontation:** If the user uses BS excuses, the AI deploys aggressive, fact-based confrontation using the rules engine and the user's own logged data.


* **The Oath:** Triggered in-thread when a hidden "Trust/Openness Score" crosses a mathematical threshold following an acknowledged breakthrough. The system requires them to write a binding "oath" to never stop improving. When the user later breaks down, the AI presents a day-1-to-now summary and their own oath to emotionally ground them.



### 3.4. Reflection & Knowledge Gathering

* **End-of-Day Journaling:** Acts as both a clarity tool and data source. Utilizes a Hybrid Interaction Flow: the user writes a raw brain dump in a distraction-free text area. If the entry is vague or signals severe issues, Davos initiates optional, targeted conversational probing in the main chat thread.


* **Permissioned Extraction:** Operates on an opt-out model. All journal entries and chat messages default to automatic extraction into the core RAG system unless the user explicitly toggles an "Unsavable" flag on that specific item in the UI.


* **Proactive Conversationalist:** The AI spontaneously initiates conversations to fill missing gaps in the user's profile, keeping the user engaged and mitigating loneliness.



### 3.5. Metric Tracking & Dashboard

* **Proof-Based Life Dashboard:** Quantifies life domains into actionable metrics ("numbers motivate more than hormones").


* **Progressive Metric Onboarding:** The user initially selects 1-2 core metrics (e.g., Finance, Fitness). As the AI learns the user's life, it identifies neglected domains (e.g., Relationships, Spirituality) and proposes custom backend-evaluated mathematical formulas (e.g., JSONLogic) mapping logs to scores. The visualization layer remains strictly constrained to a Pre-built Component Registry (e.g., heatmaps, trend lines) to prevent runtime UI code generation.



## 4. Primary User Flow

1. **Onboarding & First Conversation:** Zero setup forms. The app opens directly into the continuous chat thread where Davos sends the opening message. Davos conducts an initial conversational assessment to establish baselines, ambition, and initial life metrics through dialogue rather than forcing the user through a sterile form.


2. **The Daily Loop (Chat-Centric):** The user's primary interface is the ongoing chat thread. Hourly/bi-hourly check-ins via widget ("What did you do this hour?") feed directly into Davos’s memory. Davos proactively messages the user throughout the day to plan tasks, assign habit side-quests, or simply converse to counter loneliness and gather context.


3. **Real-Time Intervention (The Hooks):** If the user logs a deviation, ignores a check-in, or confesses an urge to doomscroll, Davos instantly triggers an intervention in the chat. Shifting dynamically between personas (e.g., empathetic therapist to ruthless mentor), Davos uses the logged "doings" data to deploy factual reality checks and psychological tactics to redirect the user.


4. **Evening Routine & Journal Extraction:** The user completes their end-of-day journaling within or alongside the chat. Davos reads it, asks conversational follow-up questions for clarity, and automatically ingests insights into his core memory (RAG) governed by the "unsavable" flag. Davos then outputs a deadline-bound plan for the next day.


5. **Dashboard Review & The Oath:** The user occasionally steps out of the chat into the Life Dashboard to view visual, metric-based proof of their progress. When Davos secures an admission of progress in the chat and the trust score threshold is met, he forces the user to write their "Oath" in the thread—locking in their commitment for future interventions.