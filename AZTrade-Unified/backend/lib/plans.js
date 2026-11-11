const PLUS = new Set(['go','plus']);
const PREMIUM = new Set(['pro','pro25','pro60','pro500','pro100','pro200','premium','business','enterprise']);
export function mapPlan(plan,status) {
 if (!['active','trialing'].includes(status) || typeof plan !== 'string') return 'free';
 const id=plan.toLowerCase();
 return PLUS.has(id)?'plus':PREMIUM.has(id)?'premium':'free';
}
