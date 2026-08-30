import crypto from "node:crypto";

const PREFIXES = {
  create: "CREATE",
  move: "MOVE",
  rename: "RENAME",
  delete: "DELETE"
};

function digest(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();
}

export class PlanStore {
  constructor(ttlSeconds) {
    this.ttlMs = ttlSeconds * 1000;
    this.plans = new Map();
  }

  create(operation, items, snapshots, summary) {
    this.prune();
    const createdAt = Date.now();
    const planId = crypto.randomUUID();
    const hash = digest({ operation, items, snapshots, createdAt, planId });
    const confirmation = `${PREFIXES[operation]}:${items.length}:${hash.slice(0, 8)}`;
    const plan = {
      planId,
      operation,
      items,
      snapshots,
      summary,
      hash,
      confirmation,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      used: false
    };
    this.plans.set(planId, plan);
    return plan;
  }

  get(planId) {
    this.prune();
    const plan = this.plans.get(planId);
    if (!plan) throw new Error("计划不存在或已过期，请重新生成");
    if (plan.used) throw new Error("计划已经执行过，不能重复使用");
    return plan;
  }

  authorize(planId, confirmation) {
    const plan = this.get(planId);
    if (confirmation !== plan.confirmation) {
      throw new Error("确认文字不匹配；请重新核对当前计划输出");
    }
    return plan;
  }

  markUsed(planId) {
    const plan = this.plans.get(planId);
    if (plan) plan.used = true;
  }

  pendingCount() {
    this.prune();
    return [...this.plans.values()].filter((plan) => !plan.used).length;
  }

  prune() {
    const now = Date.now();
    for (const [id, plan] of this.plans.entries()) {
      if (plan.expiresAt <= now || (plan.used && now - plan.createdAt > this.ttlMs)) this.plans.delete(id);
    }
  }
}

export function publicPlan(plan) {
  return {
    plan_id: plan.planId,
    operation: plan.operation,
    item_count: plan.items.length,
    items: plan.items,
    summary: plan.summary,
    confirmation_required: plan.confirmation,
    expires_at: new Date(plan.expiresAt).toISOString(),
    note: "请向用户展示完整清单与摘要；只有用户在当前对话中明确回复 confirmation_required 后才能执行。"
  };
}
