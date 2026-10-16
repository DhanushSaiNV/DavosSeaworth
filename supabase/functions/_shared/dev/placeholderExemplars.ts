// supabase/functions/_shared/dev/placeholderExemplars.ts
// FP-03 Step 2 — dev-only placeholder exemplars for the embedding classifier (D19, §6.4).
//
// DRAFT / PLACEHOLDER CONTENT: AGENTS.md §8.4 — placeholders must stay clearly labelled and
// never be presented as final content. Every seeded row carries source = "PLACEHOLDER-DEV".
// Removal is the single-step dev-smoke ?action=clear-exemplars; the Step 7 BG-04 hot-swap
// replaces them with owner-approved content (source = "BG-04") with zero code change.
//
// The real deliverable is the BG-02 signed-off 16-domain enum + BG-04 exemplar sets; these
// items exist only so the classifier can be built, seeded, calibrated and rolled back before
// that content lands. They are sized to the §6.4 [SPEC] counts, not to content quality.
//
// Labels are DATA, never hardcoded into the classifier (FR-2): the domain labels are the
// §3.3 proposed 16-string set verbatim (slashes included), the emotion labels are
// config.emotion_labels, and the quit labels are quit / false_constraint.
//
// Authoring rules applied here: first-person user voice; one idea per item; nothing that
// plausibly fits two labels (ambiguity is the golden set's job, Step 6) — the neighbouring
// domains are separated by distinctive vocabulary (Health=sleep/nutrition/medical vs
// Fitness=training; Communication=expression vs Relationships=partner); varied length and
// register inside each label; emotion items are emotion-forward with minimal domain nouns;
// no text duplicated from placeholderRules.ts. The golden set is authored separately (Step 6)
// and kept disjoint.

export interface PlaceholderExemplar {
  setKind: "domain" | "emotion" | "quit_signal";
  label: string;
  text: string;
}

export const PLACEHOLDER_EXEMPLAR_SOURCE = "PLACEHOLDER-DEV";

function build(
  setKind: PlaceholderExemplar["setKind"],
  label: string,
  texts: readonly string[],
): PlaceholderExemplar[] {
  return texts.map((text) => ({ setKind, label, text }));
}

export const PLACEHOLDER_EXEMPLARS: PlaceholderExemplar[] = [
  // ==========================================================================
  // domain set — 16 labels x 10 = 160  (§3.3 proposed list, verbatim)
  // ==========================================================================
  ...build("domain", "Career", [
    "I got passed over for the promotion again and I don't know whether to confront my manager or start applying elsewhere.",
    "My boss keeps dumping extra work on me and I never say anything about it.",
    "I have an interview next week and I'm terrified they'll ask about the gap on my résumé.",
    "I've rewritten my résumé six times and it still doesn't show what I actually did.",
    "The new hire is already doing the work I've been asking to do for a year.",
    "I want to change industries but I have no idea what a realistic first step looks like.",
    "My colleague takes credit for my ideas in every meeting and I just sit there.",
    "I'm doing the work of two people and my title still says junior.",
    "I keep drafting the message to my skip-level manager and then deleting it.",
    "My manager asked where I see myself in three years and I completely blanked.",
  ]),

  ...build("domain", "Finance", [
    "I checked my account this morning and there's less in it than I thought, with two weeks left in the month.",
    "I put a big purchase on my credit card and now I'm avoiding looking at the balance.",
    "I finally made a budget spreadsheet and then ignored it for three weeks.",
    "I want to start saving for a house but I can't stop spending on small things.",
    "My loan payment is due and I'm short by about two hundred.",
    "I don't actually know what my monthly subscriptions add up to.",
    "I got a bonus and spent most of it within the week instead of saving any.",
    "I'm scared to open the tax envelope sitting on my desk.",
    "Every month I swear I'll track my spending and every month I don't.",
    "I want to invest but I don't understand any of it and I'm scared to start.",
  ]),

  ...build("domain", "Fitness", [
    "I skipped the gym all week and now it feels like I've ruined everything.",
    "My runs keep getting shorter because I push too hard at the start.",
    "I can't do a single push-up anymore and it's humiliating.",
    "I signed up for the race and now I'm scared I can't finish the distance.",
    "I train hard for two weeks and then disappear for a month.",
    "My knees hurt when I squat and I keep training through it.",
    "I want to get stronger but I have no idea how to program the lifts.",
    "I keep comparing my body to everyone else's on the gym floor.",
    "I did my first full pull-up today and I want to tell everyone.",
    "I bought new running shoes and then never went out in them.",
  ]),

  ...build("domain", "Health", [
    "I've been sleeping five hours a night and I can feel it in everything.",
    "I haven't seen a doctor in three years and I keep putting off booking it.",
    "I have a cough that won't go away and I'm too busy to deal with it.",
    "I drink about six coffees a day and then wonder why I can't sleep.",
    "My doctor told me to cut salt and I've done nothing about it.",
    "I forget to eat until I'm shaking in the afternoon.",
    "I've had a headache for four days and I keep taking painkillers instead of asking why.",
    "I wake up at 3 a.m. and can't get back to sleep most nights.",
    "I know I need glasses but I keep squinting through the blur instead.",
    "I was ill last month and I'm still nowhere near my normal energy.",
  ]),

  ...build("domain", "Learning", [
    "I bought three online courses in the sale and I've opened none of them.",
    "I can read a whole chapter and remember nothing the next day.",
    "I'm trying to teach myself a language and I keep restarting from lesson one.",
    "I have an exam in six weeks and I've only just opened the syllabus.",
    "I take careful notes and then never look at them again.",
    "I keep watching tutorials instead of actually practising the skill.",
    "Everyone in my study group seems to grasp the material faster than I do.",
    "I want to learn to code but I can't decide which language to begin with.",
    "I passed the first module and immediately lost all motivation for the second.",
    "I memorised everything for the test and forgot it within a week.",
  ]),

  ...build("domain", "Creativity", [
    "I have a folder of half-finished songs and I can't bring myself to open it.",
    "I want to write every day but the blank page freezes me.",
    "I painted for the first time in a year and it felt like coming home.",
    "My ideas feel derivative and I'm scared to show anyone the work.",
    "I keep starting new projects before I've finished the last one.",
    "I finished a draft of my story and I'm terrified to send it to anyone.",
    "I used to sketch constantly and I have no idea why I stopped.",
    "I have an idea for a comic and I've been circling it for months.",
    "The album I'm making is never going to feel 'ready' and I know it.",
    "I want to make things but I only get forty minutes to myself a week.",
  ]),

  ...build("domain", "Relationships", [
    "My partner and I had the same argument again and I don't know how to break the loop.",
    "I've been on four dates with someone and I can't tell whether I actually like them.",
    "We've stopped touching each other and neither of us says anything about it.",
    "I'm still thinking about my ex and I hate that I am.",
    "My partner works late every night and I'm starting to resent it.",
    "I said something cruel in a fight and I can't take it back.",
    "I want to tell them how I feel but I keep waiting for the perfect moment.",
    "We've been together five years and I don't know if we want the same future.",
    "I check my partner's phone and I know I shouldn't.",
    "The long distance is wearing us down and I don't know how to fix it.",
  ]),

  ...build("domain", "Family", [
    "My mother calls every day and I've started letting it ring.",
    "My brother borrowed my car and returned it scratched without mentioning it.",
    "My kids only ever see me tired at the end of the day.",
    "My father is getting older and I don't know how to talk to him about it.",
    "Every family dinner ends in the same argument and I keep going anyway.",
    "I'm the one who organises everything for my parents and I'm exhausted.",
    "My sister is having a baby and all I feel is anxiety.",
    "I moved far from my family and I feel guilty every time I call.",
    "My teenager has stopped talking to me and I'm scared.",
    "My in-laws criticise how we raise our daughter and I bite my tongue.",
  ]),

  ...build("domain", "Social", [
    "I left the party early because I couldn't manage the small talk.",
    "I have a hundred contacts and no one I could call at 2 a.m.",
    "I keep turning down invitations and then wonder why I feel lonely.",
    "Someone at the gathering asked what I do and I completely froze.",
    "I don't really have a group anymore and I don't know how to find one.",
    "I went out and spent the whole evening wishing I was home.",
    "My oldest friend and I have nothing left to talk about.",
    "I'm always the one who initiates, so I've stopped.",
    "I feel invisible in every group I'm part of.",
    "I moved to a new city and haven't spoken to anyone in a month.",
  ]),

  ...build("domain", "Mental/Emotional", [
    "I feel flat all the time and I can't explain it to anyone.",
    "The anxiety wakes me before my alarm every single day.",
    "I keep telling myself I'm fine and I'm clearly not.",
    "I had a good week and now I'm just waiting for the crash.",
    "I'm so overwhelmed that I can't start anything at all.",
    "I cried in the car for no reason I could name.",
    "I feel like a fraud and everyone is about to find out.",
    "I'm angry all the time and I don't know what at.",
    "I don't enjoy anything I used to enjoy and that scares me.",
    "I isolate for a week and then hate myself for disappearing.",
  ]),

  ...build("domain", "Spirituality", [
    "I haven't prayed in months and I miss the feeling of it.",
    "I want to believe but I'm not sure I do anymore.",
    "I sat with my grandmother's rosary and cried.",
    "I've started going back to the temple and it feels less like home than I hoped.",
    "I don't know what I believe about what happens after we die.",
    "I used to find peace in meditation and now I just sit there restless.",
    "I feel a pull toward something larger and I can't name it.",
    "My faith community doesn't feel safe to me anymore.",
    "I want to practise gratitude but it feels like pretending.",
    "A blessing I didn't expect landed on me and I don't know how to receive it.",
  ]),

  ...build("domain", "Discipline/Habits", [
    "I've made my bed every day for a month and it's the only thing holding me together.",
    "I broke my streak and now I don't see the point of continuing.",
    "I keep promising myself I'll start on Monday.",
    "I set six alarms and still hit snooze through all of them.",
    "My evenings evaporate into scrolling and I can't stop it.",
    "I said I'd do ten minutes a day and I've done nothing for a week.",
    "I wrote the plan in my notebook and never opened it again.",
    "I can be disciplined for other people and never for myself.",
    "I keep the phone in the bedroom and then use it until midnight.",
    "I want a routine so badly and I can't hold one for more than four days.",
  ]),

  ...build("domain", "Communication", [
    "I rehearsed what I'd say for an hour and then said 'never mind'.",
    "I can't tell my friend that what she said hurt my feelings.",
    "I interrupt people when I'm nervous and I know it's rude.",
    "I have something important to say to my manager and I keep softening it away.",
    "I never know how to end a conversation without it being awkward.",
    "When I'm criticised I shut down completely instead of answering.",
    "I've been told I'm too blunt and I don't know where the line is.",
    "I agreed with something I disagree with just to end the argument.",
    "I write the honest message and then rewrite it twelve times.",
    "I need to ask for something and I keep apologising for needing it.",
  ]),

  ...build("domain", "Environment/Home", [
    "My desk is covered in things I haven't dealt with in months.",
    "I can't find anything in my kitchen and it makes me not want to cook.",
    "I moved in six months ago and half the boxes are still unopened.",
    "The mess in my flat is starting to affect my sleep.",
    "I clean everything in one weekend and then let it collapse again.",
    "My workspace has no natural light and I dread sitting down in it.",
    "I keep buying storage to solve clutter that storage can't solve.",
    "I want my home to feel calm and instead it feels like a storage unit.",
    "My wardrobe is full and I wear the same five things.",
    "I repainted the spare room and it's still full of junk.",
  ]),

  ...build("domain", "Recreation", [
    "I played football on Sunday and remembered what joy feels like.",
    "I bought a board game and can't find anyone to play it with.",
    "I have three days off and I've planned absolutely nothing.",
    "I want to travel somewhere alone but I keep finding reasons not to.",
    "I watched a whole season in one weekend and felt hollow afterwards.",
    "I haven't done anything purely for fun in weeks.",
    "My holiday is booked and I'm already dreading the return.",
    "I want a hobby that isn't just staring at a screen.",
    "I took the kids to the park and actually enjoyed it instead of watching the clock.",
    "I used to fish with my grandfather and I'd like to start again.",
  ]),

  ...build("domain", "Purpose/Legacy", [
    "I'm forty and I still don't know what I'm for.",
    "I want to leave something behind that outlasts me.",
    "My work pays well and means nothing, and that's starting to hurt.",
    "I keep asking myself what the point of all this effort is.",
    "I want to mentor someone but I'm not sure I have anything worth giving.",
    "I imagine my own funeral and worry no one would have much to say.",
    "I've achieved the goals I set ten years ago and I feel empty.",
    "I want my life to have mattered beyond my own comfort.",
    "I wonder whether I'm building anything that will last.",
    "I don't want to be remembered for what I own.",
  ]),

  // ==========================================================================
  // emotion set — 6 labels x 8 = 48  (config.emotion_labels)
  // ==========================================================================
  ...build("emotion", "frustrated", [
    "I've done everything right and it still isn't working.",
    "I keep hitting the same wall over and over.",
    "Nothing I try makes any difference and I'm sick of it.",
    "I explain myself and no one really listens.",
    "It should have worked by now.",
    "I'm trying so hard and getting nowhere at all.",
    "Every time I fix one thing, something else breaks.",
    "I'm so tired of starting over from the beginning.",
  ]),

  ...build("emotion", "exhausted", [
    "I can barely keep my eyes open and it's only the afternoon.",
    "I have nothing left to give today.",
    "I'm running on empty and there's no end in sight.",
    "I slept and I still feel like I haven't.",
    "I don't have the energy to care about this right now.",
    "Everything feels heavy and all I want is to lie down.",
    "I've been pushing for so long that stopping feels impossible.",
    "I'm spent. Completely.",
  ]),

  ...build("emotion", "anxious", [
    "Something bad is going to happen and I can feel it.",
    "My chest is tight and I can't slow my breathing down.",
    "I keep running the worst case over in my head.",
    "I'm dreading something I can't even name.",
    "The waiting is unbearable and I can't sit still.",
    "I'm frightened and I don't know of what exactly.",
    "I keep checking the same things over and over.",
    "My mind won't stop racing.",
  ]),

  ...build("emotion", "proud", [
    "I finally did the thing I'd been scared of.",
    "I held the boundary and it felt right.",
    "I saw how far I've come and I actually smiled.",
    "I showed up for myself and I'm glad I did.",
    "I did it on my own and it worked.",
    "I kept my word to myself this time.",
    "I'm genuinely pleased with what I made.",
    "I want to mark this one properly.",
  ]),

  ...build("emotion", "determined", [
    "I'm not stopping until this is finished.",
    "Whatever it takes, I'm doing it this time.",
    "I've decided and there's no going back now.",
    "I know it's hard and I'm doing it anyway.",
    "This time I'm finishing what I started.",
    "I'll keep going until it's right.",
    "Nothing is going to talk me out of this.",
    "I'm ready to put in the work.",
  ]),

  ...build("emotion", "avoidant", [
    "I'll deal with it tomorrow.",
    "I've been meaning to open that email for a week.",
    "I changed the subject so I wouldn't have to answer.",
    "I keep saying I'll do it later, and later never comes.",
    "I haven't looked at the numbers on purpose.",
    "I know I'm avoiding it and I'm still not doing it.",
    "I keep making excuses that even I don't believe.",
    "I put it on a list and never looked at the list.",
  ]),

  // ==========================================================================
  // quit_signal set — 10 quit + 10 false_constraint = 20
  // ==========================================================================
  ...build("quit_signal", "quit", [
    "I don't think I'm ever going to manage this.",
    "Maybe some people just aren't built for it and I'm one of them.",
    "I've tried everything and I'm done trying.",
    "There's no point in continuing with this.",
    "I'm not the kind of person who can do this.",
    "I should just accept that this isn't for me.",
    "I keep failing at the same thing, so I'm going to stop.",
    "Nothing is going to change, so why bother.",
    "I'm giving up on it. It's not happening.",
    "I've lost the belief that this is possible for me.",
  ]),

  ...build("quit_signal", "false_constraint", [
    "I can't start until I have all the right equipment.",
    "I'm not allowed to rest until the list is empty.",
    "I can only work if I have a completely clear morning.",
    "I have to finish everything before I'm allowed to enjoy anything.",
    "I can't say no to anyone, it would be rude.",
    "I must never let anyone see me struggle.",
    "I can't do it at all unless I do it perfectly.",
    "I have to answer every message the moment it arrives.",
    "If I miss a single day then the whole thing doesn't count.",
    "I should be able to handle this on my own without any help.",
  ]),
];
