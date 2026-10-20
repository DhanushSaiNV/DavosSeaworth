// supabase/functions/_shared/content/exemplars/bg04.ts
// FP-03 Step 7 - the BG-04 exemplar content slot (FR-16, AC-8, D19, sec 6.4).
//
// APPROVED - the owner-approved BG-04 set, revised on the owner's instruction
// 2026-10-20 after the first post-swap golden gate (7/12 clear-domain). The revision
// adds five targeted domain exemplars for the observed misses. Seeding remains a
// content-only operation: no classifier, pipeline or schema code change is made by
// this revision (FR-16). `content/exemplars.csv` is the authoring source and this
// module is its deployable copy. Only approved content is seeded
// (AGENTS.md sec 8.4); the approval/revision record is
// `content/reports/FP-03-BG04-APPROVAL-RECORD.md`.
//
// Why `_shared/content/` and not the repo-root `content/`: an Edge Function is bundled
// from the `supabase/functions` tree only, and this repo deploys API-side (Docker is
// not run locally), so an import from outside that tree would pass local gates and then
// fail `supabase functions deploy`. The `_shared` tree is the documented shared location.
//
// The 233 rows are exactly the approved set: 165 domain (16 x 10 plus five targeted
// revision rows), 48 emotion (6 x 8), 20 quit_signal (10 quit + 10 false_constraint).
// Nothing else reads this module - not the pipeline, not the classifier, not any
// non-dev action.

/** Which exemplar set an item belongs to - mirrors `exemplars.set_kind` (GLOSSARY sec 14). */
export type Bg04SetKind = "domain" | "emotion" | "quit_signal";

export interface Bg04Exemplar {
  setKind: Bg04SetKind;
  label: string;
  text: string;
}

/** FR-1: the two `exemplars.source` values are `PLACEHOLDER-DEV` and `BG-04`. This module owns the second. */
export const BG04_EXEMPLAR_SOURCE = "BG-04";

/** Owner approval landed 2026-10-20; only approved content is seeded (AGENTS.md sec 8.4). */
export const BG04_STATUS = "approved";

/** The owner-approved BG-04 set (233 rows). */
export const BG04_EXEMPLARS: Bg04Exemplar[] = [
  {
    setKind: "domain",
    label: "Career",
    text: "I keep fighting battles on my opponent's terms — how do I change the game?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "How do I choose which battles are worth fighting and which to let go of?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "What's a practical way to play long games with long-term people in a short-term world?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "I lead from behind — how do I lead from the front with actual skin in the game?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "What I tolerate becomes the culture — how do I set the standard by my own example?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "How do I develop my people so they become leaders who multiply my impact?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "How do I build a team that can run the mission without me?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "People endure anything with a purpose — how do I give them a 'why' worth enduring for?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "I'm stuck in a role that pays okay but drains me — how do I figure out my next move without torching everything?",
  },
  {
    setKind: "domain",
    label: "Career",
    text: "How do I prove I'm ready for more responsibility without burning out to show it?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "I earn decent money but nothing accumulates — where does it all go?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "How do I actually start investing early when I have so many expenses?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "What does 'never lose money' mean practically for someone without a safety net?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "I don't understand most investments — how do I know what I actually own and why?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "How do I create multiple income streams when I barely have time for one job?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "What assets actually work while I sleep vs. ones that just look good on paper?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "How do I pay myself first when every dollar is already spoken for?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "I can't tell assets from liabilities in my own life — how do I learn the difference?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "Giving significantly feels impossible right now — how do I start small and build the habit?",
  },
  {
    setKind: "domain",
    label: "Finance",
    text: "Every raise disappears into lifestyle creep — how do I actually keep the money?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "I sit all day and feel terrible — what's the minimum movement that actually helps?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "What does training for both strength and endurance look like with limited time?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "Cold exposure sounds miserable — is there a version that's actually doable?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "I know motion is medicine but I can't make myself do it consistently.",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "What's the simplest daily movement habit that compounds over years?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "I pay for a gym membership and never go — how do I actually train consistently?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "I've never done strength training and feel intimidated — where do I even start?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "How do I build cardio endurance from zero when I've always hated running?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "I train hard but never recover — how do I take rest days seriously?",
  },
  {
    setKind: "domain",
    label: "Fitness",
    text: "How do I tell if I'm actually progressing when the mirror looks the same?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "How do I protect sleep as non-negotiable when work bleeds into every evening?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "I eat for comfort, not fuel — how do I change that without hating every meal?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "How do I guard cognitive clarity when coffee and stress are my baseline?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "My stress is chronic and I've normalized it — how do I start managing it actively?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "How do I eat to fuel performance when I don't know what that actually means?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "I haven't seen a doctor in years — how do I catch up on preventive care without the dread?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "My energy crashes hard every afternoon — how do I stop the daily spiral?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "I'm always coming down with something — how do I stop getting sick constantly?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "My sleep is wrecked by late-night screens — how do I fix my sleep hygiene?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "I survive on takeout and skipped meals — how do I rebuild basic eating habits?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I think I understand something until I try to teach it — how do I use teaching to expose the gaps?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I only learn from living people — how do I access the dead minds who solved this centuries ago?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I consume endlessly but apply nothing — how do I apply what I learn immediately?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "How do I be a beginner again in something every year when expertise pays the bills?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "What does a personal curriculum look like — how do I build one and actually follow it?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I learn from theorists — how do I find practitioners who've actually done the thing?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "Knowledge decays fast — how do I make learning stick without constant re-reading?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I'm an expert in one thing — how do I keep a novice mind in everything else?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "My learning is reactive — how do I make it deliberate with the discipline of a student?",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I cram everything the night before and forget most of it — how do I space out my learning?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "Everything I make feels derivative — how do I steal from everywhere without copying?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "I produce so little — how do I generate volume when every piece feels precious?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "How do I cross-pollinate disciplines when my work is hyper-specialized?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "My creative time gets eaten by urgent tasks — how do I protect it non-negotiably?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "Constraints paralyze me — how do I use limitations to force invention instead?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "I grind on problems and get nowhere — how do I actually incubate and step away?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "My curiosity feels random and useless — how do I pursue it relentlessly without guilt?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "I wait for inspiration — how do I build a practice that doesn't need it?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "How do I know if an idea is worth pursuing or just shiny distraction?",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "What does a daily creative practice look like for someone who isn't 'an artist'?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "I talk way more than I listen — how do I actually shut up and hear people?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "How do I make people feel genuinely seen instead of just performing attention?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "What should I actually look for in a life partner beyond surface compatibility?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "I have toxic people I can't cut off — how do I do it without the guilt spiral?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "How do I mentor others when I still feel like I have no idea what I'm doing?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "Arguments never change minds — how do I change someone's environment instead?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "I let conflicts fester until they're huge — how do I repair relationships quickly?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "My partner and I keep having the same fight — how do we break the loop?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "How do I rebuild trust after I broke it with someone I love?",
  },
  {
    setKind: "domain",
    label: "Relationships",
    text: "I love my partner but we've become roommates — how do we get the closeness back?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "I snap at my kids more than I ever want to — how do I show up differently as a parent?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "My aging parents need more help and I don't know how to be there for them.",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "How do I set boundaries with my family without feeling like I'm betraying them?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "My sibling and I can't get through a single visit without old fights resurfacing.",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "Work swallows the time I promised my family — how do I actually be present at home?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "How do I break the patterns I inherited from my family instead of passing them on?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "We keep contradicting each other in front of the kids — how do we get aligned on parenting?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "I live far from my family and the guilt never goes away — how do I stay connected from a distance?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "Family gatherings leave me drained and small — how do I protect myself without withdrawing completely?",
  },
  {
    setKind: "domain",
    label: "Family",
    text: "Everyone's in their own room on a screen — how do we get real family time back?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "Everyone around me drags me down — how do I find people who pull me up?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I feel lonely even around people — how do I build real connection?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "How do I choose my inner circle deliberately instead of by proximity?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I haven't made a new friend since school — how do I make friends as an adult?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I dread small talk but feel isolated — how do conversations ever get real?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I cancel plans constantly and regret it — how do I stop isolating myself?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "How do I keep friendships alive when everyone's buried in their own lives?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I feel like I don't belong anywhere — how do I find my people?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "My friendships never go past the surface — how do I go deeper?",
  },
  {
    setKind: "domain",
    label: "Social",
    text: "I moved to a new city and know no one — how do I build a social life from zero?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "How do I stop overthinking every decision?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "I keep second-guessing myself on things that shouldn't matter this much.",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "My mind races at night with problems I can't solve right now.",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "What's the difference between productive thinking and unproductive rumination?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "I lie to myself about my progress — how do I be brutally honest without crushing myself?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "Success makes me arrogant, failure makes me bitter — how do I cultivate humility through both?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "I complain constantly — how do I stop when it feels like the only relief?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "Criticism destroys me — how do I develop thick skin without becoming callous?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "I hold grudges that hurt me more than them — how do I forgive quickly for my own sake?",
  },
  {
    setKind: "domain",
    label: "Mental/Emotional",
    text: "How do I treat failure as data when it feels like a verdict on my worth?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "How do I develop a daily practice of stillness when my mind never stops?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "I can't accept what I can't control — how do I reach actual equanimity?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "Gratitude feels forced — how do I make it rewire my perception instead of being performative?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "Death terrifies me — how do I contemplate mortality regularly without spiraling?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "Non-attachment sounds like indifference — how do I act fully while holding outcomes lightly?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "My outer world is chaos — how do I master the inner world first?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "How do I sit quietly in a room alone when every part of me resists it?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "I cling to outcomes — how do I care deeply without the suffering of attachment?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "Everyone says my inner world shapes my outer one — how do I actually live that?",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "Every tradition says stillness works — how do I start when it feels pointless?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "My habits are accidental — how do I make my daily routine the autobiography I want?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "My environment makes good behaviors hard — how do I flip it so good is automatic and bad is difficult?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I lose the morning — how do I win the first hour so it sets the tone for the day?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I miss once and quit — how do I 'never miss twice' when the streak is already broken?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I rely on motivation — how do I stack new habits onto established triggers so I never need willpower?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I set goals but never build systems — how do I shift from goals to systems?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I start projects strong but always lose momentum halfway through.",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "How do I show up every day when motivation is gone?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "How do I finish what I start instead of abandoning things at 80%?",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I feel like I'm practicing but not improving — how do I make practice deliberate?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "I ramble — how do I speak and write with clarity when the idea is complex?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "Data doesn't move people — how do I tell stories that actually drive action?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "I argue to win instead of understanding — how do I steelman the other side first?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "How do I write daily when I have nothing to say?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "I fill every silence with words — how do I learn to use quiet as a tool?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "My communication style is me-me-me — how do I match my audience instead of myself?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "My explanations lose people halfway — how do I make complex ideas land?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "How do I make abstract arguments visceral with stories and parables?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "What does 'if you can't explain it to a six-year-old, you don't understand it' look like in practice?",
  },
  {
    setKind: "domain",
    label: "Communication",
    text: "How do I give feedback that lands without making the other person defensive?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "My space is constant chaos — how do I declutter when it's overwhelming?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "I work from my bed and it's wrecking both my rest and my focus — how do I separate my spaces?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "How do I set up a corner of my home just for deep work?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "My phone's home screen sabotages me all day — how do I redesign my digital environment?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "How do I design my home so it supports the person I'm trying to become?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "I've never made my rental feel like home — is it worth investing in a place I don't own?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "I clean up and it collapses back within days — how do I keep my space from re-cluttering?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "I live somewhere that drains my energy — how do I make my home restore me instead?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "How do I carve out personal space when I share my home with a full family?",
  },
  {
    setKind: "domain",
    label: "Environment/Home",
    text: "How do I make my home feel like a place I actually want to live in, not just where I store my stuff?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "Rest feels like laziness — how do I give myself permission to actually recharge?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "I can't remember the last time I did something just for fun — how do I bring play back?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "Every weekend I collapse into screens and wake up Monday more drained — how do I actually recharge?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "My hobbies all died under work — how do I revive one without turning it into another job?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "How do I protect real vacation time when work follows me everywhere?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "I don't have a single hobby outside work — where do I even start?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "Play feels childish for a grown adult — how do I take fun seriously?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "How do I fill my free time with things that energize me instead of numbing me?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "I've optimized all the joy out of my life — how do I get it back?",
  },
  {
    setKind: "domain",
    label: "Recreation",
    text: "I save what I love for 'someday' and someday never comes — how do I make time for it now?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "I don't know what only I can do — how do I find it?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "Everything I build feels temporary — how do I make something that outlives me?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "My values are vague — how do I define them early so they actually decide for me?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "How do I serve something larger than myself when I'm barely keeping my head above water?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "I rush through moments — how do I live as if each one is both first and last?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "What would I still do unpaid — how do I find the work I'd keep doing even without a paycheck?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "I chase achievements that feel hollow — how do I measure success by legacy instead?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "How do I find meaning in the mundane instead of waiting for a grand purpose?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "My purpose shifts constantly — how do I commit without feeling trapped?",
  },
  {
    setKind: "domain",
    label: "Purpose/Legacy",
    text: "What's the one thing I'd regret not doing at 80 — and why aren't I doing it now?",
  },
  {
    setKind: "domain",
    label: "Health",
    text: "I'm running on four hours of sleep a night and my body feels like it's breaking down.",
  },
  {
    setKind: "domain",
    label: "Learning",
    text: "I'm partway through a statistics course and the lectures still go over my head.",
  },
  {
    setKind: "domain",
    label: "Creativity",
    text: "When I sit down to write, the ideas stay stuck in my head and won't reach the page.",
  },
  {
    setKind: "domain",
    label: "Spirituality",
    text: "I've stopped praying and I no longer feel connected to my faith.",
  },
  {
    setKind: "domain",
    label: "Discipline/Habits",
    text: "I keep staying up until 2 a.m. even after promising myself I'd go to bed early.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "I'm so frustrated right now I can't think straight.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "Nothing is working and I'm about to snap.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "Why does everything have to be this difficult?",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "I've been at this for weeks and I'm still stuck in the same spot — it's maddening.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "This shouldn't be this hard and I'm furious about it.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "Every step forward feels like two steps back — I'm at the end of my rope.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "I'm frustrated with myself more than anything else.",
  },
  {
    setKind: "emotion",
    label: "frustrated",
    text: "The gap between where I am and where I want to be is infuriating.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "I can't keep going like this — I'm completely drained.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "My energy is gone and I have nothing left to give.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "I'm exhausted in a way sleep doesn't fix.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "Every day feels like climbing a mountain with no summit.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "I'm running on fumes and don't know how to refuel.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "The weight of everything is crushing me — I need to stop.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "I'm exhausted from fighting the same battles over and over.",
  },
  {
    setKind: "emotion",
    label: "exhausted",
    text: "There's a bone-deep tiredness that no weekend cures.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "My chest is tight and I can't shake this dread.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "I'm anxious about everything and nothing specific at the same time.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "What if everything goes wrong? I can't stop the spiral.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "The uncertainty is paralyzing — I need something to hold onto.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "My mind races through worst-case scenarios I can't control.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "I feel anxious even when things are going well — waiting for the other shoe to drop.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "There's a constant hum of worry underneath everything I do.",
  },
  {
    setKind: "emotion",
    label: "anxious",
    text: "How do I function when anxiety makes every decision feel impossible?",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "I'm actually proud of myself for showing up today.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "That was hard and I did it anyway — and that matters.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "I want to acknowledge the progress nobody else sees.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "For the first time in a long time, I feel good about my effort.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "I'm proud of how I handled that situation — it wasn't easy.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "The person I'm becoming is worth the struggle I've endured.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "I saw it through when it got hard — that's something to be proud of.",
  },
  {
    setKind: "emotion",
    label: "proud",
    text: "Looking back, I've come further than I thought possible.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "I'm going to finish this no matter what it takes.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "This obstacle isn't the end — it's just the next thing to solve.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "I've decided. The outcome is no longer a question.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "Whatever it costs, I'm seeing this through.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "My determination is the only thing I can count on right now.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "I will find a way or make one — there is no alternative.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "Every 'no' is just information. I keep moving.",
  },
  {
    setKind: "emotion",
    label: "determined",
    text: "This is the hill I'm willing to die on — I'm not backing down.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "I keep putting this off because I don't want to face it.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "The thought of starting makes me want to disappear.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "I'm avoiding the one thing that would actually help.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "It's easier to scroll than to deal with what's in front of me.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "I've been avoiding this conversation for weeks — months.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "Every time I think about it, I find something else to do.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "The avoidance is worse than the thing itself — I know this.",
  },
  {
    setKind: "emotion",
    label: "avoidant",
    text: "I'm hiding from my own life and I don't know how to stop.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "I'm done, I give up.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "There's no point in continuing — I quit.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "I can't do this anymore. I'm stopping.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "This isn't worth it. I'm walking away.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "I've tried everything and nothing works. I'm done.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "Why bother? I'm giving up on this completely.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "I quit. There's no coming back from this.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "That's it. I'm throwing in the towel.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "No more effort. I'm checking out.",
  },
  {
    setKind: "quit_signal",
    label: "quit",
    text: "I surrender. This is over.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "I don't have time for this — my schedule is completely full.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "I'm just not the kind of person who can do this.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "It's too late for me to start now — I missed my window.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "I don't have the money or connections to make this work.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "My circumstances are different — this advice doesn't apply to me.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "I would, but my situation at home makes it impossible.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "It's not in my nature — I'm wired differently.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "The system is rigged against people like me.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "I've already tried that exact thing and it failed — it won't work now.",
  },
  {
    setKind: "quit_signal",
    label: "false_constraint",
    text: "There's literally nothing I can do — my hands are tied.",
  },
];
