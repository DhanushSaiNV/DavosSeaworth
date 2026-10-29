// supabase/functions/_shared/degradePair.test.ts
// FP-10 Step 2 - the atomic degrade pair's fault-injection unit (FR-4; TECH-SPEC §4.1, §5.1).
//
// AC-4's evidence: the pair is one RPC, so the only two outcomes are "both rows" and "neither".
// These cases pin the second one - an RPC error throws and yields no holding reply id - plus
// the race answer and the argument shape FP-02/04's degrade gates assert on the persisted row.

import {
  buildDegradePairArgs,
  DEGRADE_PAIR_RPC,
  writeDegradePair,
  type DegradePairClient,
} from "./degradePair.ts";

interface Expectation {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
}
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (actual: unknown) => Expectation;

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const REPLY_ID = "44444444-4444-4444-8444-444444444444";
const WINNER_ID = "55555555-5555-4555-8555-555555555555";

const ARGS = {
  userId: USER_ID,
  userMessageId: MESSAGE_ID,
  jobId: JOB_ID,
  content: "One moment - I'm still with you.",
  context: { route: "low", persona: "mentor_tough", domain: "Health" },
};

interface Call {
  name: string;
  args: Record<string, unknown>;
}

/** A fake client that records the call and returns a canned answer. */
function fakeClient(response: { data: unknown; error: { message?: string } | null }): {
  client: DegradePairClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc(name, args) {
        calls.push({ name, args });
        return Promise.resolve(response);
      },
    },
  };
}

async function failureOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("buildDegradePairArgs (row shape FP-02/04 assert)", () => {
  it("writes the holding row's metadata with the pre-minted job id", () => {
    const args = buildDegradePairArgs(ARGS) as {
      p_metadata: Record<string, unknown>;
      p_payload: Record<string, unknown>;
    };
    expect(args.p_metadata.route).toBe("degrade");
    expect(args.p_metadata.source).toBe("sync_degrade");
    expect(args.p_metadata.user_message_id).toBe(MESSAGE_ID);
    expect(args.p_metadata.source_job_id).toBe(JOB_ID);
    expect(args.p_metadata.domain).toBe("Health");
  });

  it("carries the routing decision to the retry job", () => {
    const args = buildDegradePairArgs(ARGS) as { p_payload: Record<string, unknown> };
    expect(args.p_payload.route).toBe("low");
    expect(args.p_payload.persona).toBe("mentor_tough");
    expect(args.p_payload.domain).toBe("Health");
    expect(args.p_payload.user_id).toBe(USER_ID);
    expect(args.p_payload.user_message_id).toBe(MESSAGE_ID);
  });

  it("omits an absent domain from the metadata but keeps the payload keys null", () => {
    const args = buildDegradePairArgs({ ...ARGS, context: undefined }) as {
      p_metadata: Record<string, unknown>;
      p_payload: Record<string, unknown>;
    };
    expect("domain" in args.p_metadata).toBe(false);
    expect(args.p_payload.route).toBe(null);
    expect(args.p_payload.persona).toBe(null);
    expect(args.p_payload.domain).toBe(null);
  });
});

describe("writeDegradePair (AC-4: both rows or neither)", () => {
  it("returns both ids on the happy path", async () => {
    const { client, calls } = fakeClient({
      data: { status: "ok", assistant_message_id: REPLY_ID, job_id: JOB_ID },
      error: null,
    });
    const result = await writeDegradePair(client, ARGS);
    expect(result).toEqual({ ok: true, assistantMessageId: REPLY_ID, jobId: JOB_ID });
    expect(calls.length).toBe(1);
    expect(calls[0].name).toBe(DEGRADE_PAIR_RPC);
    expect(calls[0].args.p_job_id).toBe(JOB_ID);
  });

  it("throws on an RPC error - the pair rolled back, so there is no reply to return", async () => {
    const { client } = fakeClient({ data: null, error: { message: "duplicate key" } });
    const message = await failureOf(writeDegradePair(client, ARGS));
    expect(message.indexOf("write_degrade_pair failed") === 0).toBe(true);
    expect(message.indexOf("duplicate key") > 0).toBe(true);
  });

  it("reports race_lost with the winner and never claims a holding reply", async () => {
    const { client } = fakeClient({
      data: { status: "race_lost", winner_id: WINNER_ID },
      error: null,
    });
    expect(await writeDegradePair(client, ARGS)).toEqual({ ok: false, winnerId: WINNER_ID });
  });

  it("tolerates a race_lost answer with no winner id", async () => {
    const { client } = fakeClient({ data: { status: "race_lost", winner_id: null }, error: null });
    expect(await writeDegradePair(client, ARGS)).toEqual({ ok: false, winnerId: null });
  });

  it("throws on an unrecognised shape rather than returning a half-filled success", async () => {
    for (const data of [{ status: "ok" }, { status: "ok", assistant_message_id: REPLY_ID }, {}, null]) {
      const { client } = fakeClient({ data, error: null });
      const message = await failureOf(writeDegradePair(client, ARGS));
      expect(message.indexOf("unexpected shape") > 0).toBe(true);
    }
  });
});
