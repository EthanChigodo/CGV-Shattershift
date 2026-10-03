/**
 * The companion: both scientist models load and rig, every action poses
 * cleanly, walking moves his legs, he stands on a route, turns his head the
 * right way, and holds a prop in his hand.
 */

export const name = "companion";

export async function run(page) {
  const result = await page.evaluate(async () => {
    const out = [];
    const check = (label, ok, detail = "") => out.push([label, !!ok, detail]);
    const s = __story;
    const { THREE, okoro } = s;
    const { ACTIONS, Companion, loadStoryCharacter } = await import("/src/story/companion.js");

    check("Dr. Okoro's model is in and rigged", okoro.model && okoro.rig?.valid && !okoro.standIn.visible);
    const head = okoro.headPosition(new THREE.Vector3());
    check("head at a person's height", head.y > 1.55 && head.y < 1.95, head.y.toFixed(2));

    const finite = () => {
      let ok = true;
      okoro.model.traverse((o) => {
        if (o.isBone && !Number.isFinite(o.quaternion.x + o.quaternion.y + o.quaternion.z + o.quaternion.w)) ok = false;
      });
      return ok;
    };
    for (const action of ACTIONS) {
      okoro.act(action);
      okoro.update(0.5, { speed: action === "run" ? 6 : 1.5 });
      okoro.update(0.5);
      check(`action "${action}" poses cleanly`, finite());
    }

    // Walking: the thighs swing.
    okoro.act("walk");
    const thigh = okoro.rig.bones.thighL;
    const a = thigh.quaternion.clone();
    okoro.update(0.25, { speed: 1.5 });
    const b = thigh.quaternion.clone();
    check("walking swings the legs", a.angleTo(b) > 0.05, a.angleTo(b).toFixed(3));

    // On a route.
    okoro.follow(s.corridorRoute, 10, -0.5);
    check("follow() stands him on the route", Math.abs(okoro.root.position.z + 10) < 1e-6 && Math.abs(okoro.root.position.x - 29.5) < 1e-6);

    // Head turn: a target on his right (+X when facing -Z) turns his head right.
    okoro.root.position.set(0, 0, 0);
    okoro.root.rotation.y = 0;
    okoro.act("idle").lookAt(new THREE.Vector3(2, 1.6, -0.2));
    for (let i = 0; i < 30; i += 1) okoro.update(1 / 30);
    check("lookAt turns the head toward the target", okoro.headYaw < -0.6, okoro.headYaw.toFixed(2));
    okoro.lookAt(null);

    // A prop in the hand.
    okoro.act("aim");
    okoro.hold(s.pistol, { hand: "R" });
    okoro.update(1 / 30);
    const hand = okoro.rig.bones.handR.getWorldPosition(new THREE.Vector3());
    const gun = s.pistol.getWorldPosition(new THREE.Vector3());
    check("a held prop sits in his hand", hand.distanceTo(gun) < 0.12, hand.distanceTo(gun).toFixed(3));
    okoro.drop(s.pistol);
    check("drop() lets go", !okoro.props.length && !s.pistol.parent);
    check("he carries the bag", !!okoro.bag?.userData.duffel);

    // Dr. Vale's model too.
    const vale = new Companion();
    vale.setModel(await loadStoryCharacter(new URL("/assets/meltdown/", location.href).href, "scientistEvil"));
    vale.act("talk");
    vale.update(0.3);
    check("Dr. Vale's model is in and rigged", vale.model && vale.rig?.valid);
    const valeHead = vale.headPosition(new THREE.Vector3());
    check("Dr. Vale's head at a person's height", valeHead.y > 1.55 && valeHead.y < 1.95, valeHead.y.toFixed(2));
    vale.dispose();
    return out;
  });
  const failures = result.filter(([, ok]) => !ok).map(([label, , detail]) => `${label}${detail !== "" ? ` (${detail})` : ""}`);
  return { failures, notes: { cases: result.length } };
}
