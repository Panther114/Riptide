import { IOWA, FR } from '../src/sim/shipClass';
console.log([50, 59, 76.5, 87, 151, 158.5, 166, 187, 203].map((f) => f + ':' + FR(f).toFixed(1)).join(' '));
console.log(IOWA.modules.map((m) => `${m.id} ${m.rect.x0.toFixed(1)}..${m.rect.x1.toFixed(1)} y${m.rect.y1.toFixed(1)}`).join('\n'));
