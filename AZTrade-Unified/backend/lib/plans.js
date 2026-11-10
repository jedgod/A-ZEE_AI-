export function mapPlan(plan, status) {
 if (status !== 'active' && status !== 'trialing') return 'free';
 const tiers = new Map([['free','free'],['go','plus'],['plus','plus'],['premium','premium'],['pro','premium'],['business','premium'],['enterprise','premium']]);
 return tiers.get(String(plan).toLowerCase()) ?? 'free';
}
