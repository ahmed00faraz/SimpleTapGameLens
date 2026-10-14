// Ring Runner: polar-motion runner on a fixed ring. The player jumps inward
// on a parabolic arc; thorn demons circle the ring in the opposite direction.
// Progress is shown as a pink trail that fills the ring as the player travels.
@component
export class GameController extends BaseScriptComponent {
  @input
  player: SceneObject;

  // Thorn demons. Assign all three in the Inspector, or leave them empty and
  // name direct children "Obstacle Demon", "Obstacle Demon 1", "Obstacle Demon 2".
  @input
  hazardOne?: SceneObject;

  @input
  hazardTwo?: SceneObject;

  @input
  hazardThree?: SceneObject;

  @input
  gameOverUI: SceneObject = null;

  @input
  ringRadius: number = 0.35;

  // Starting angle for the player (degrees).
  @input
  startAngleDegrees: number = 60.0;

  @input
  playerSpeed: number = 1.8;

  @input
  hazardSpeed: number = 0.7;

  @input
  jumpDepth: number = 0.13;

  @input
  jumpDuration: number = 0.5;

  @input
  collisionAngleDegrees: number = 11.0;

  @input
  collisionRadius: number = 0.055;

  // A jump at least this deep (inward distance from the ring) clears thorns.
  @input
  safeJumpDepth: number = 0.065;

  // Diameter of each demon in the ring's parent anchor space.
  @input
  demonSize: number = 0.16;

  @input
  trailSegmentCount: number = 96;

  @input
  trailSegmentLength: number = 0.04;

  @input
  trailThickness: number = 0.028;

  // Portrait ScreenTransforms use a narrower X axis than Y axis. This makes
  // the polar ring render as a physical circle around the face.
  @input
  horizontalRadiusMultiplier: number = 1.78;

  // Optional: a material with a float input named "coverage" (0..1).
  @input
  ringMaterial?: Material;

  private readonly fullCircle = Math.PI * 2;
  private readonly hazardOffsets = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  private readonly degToRad = Math.PI / 180;
  private readonly radToDeg = 180 / Math.PI;

  private hazards: SceneObject[] = [];
  private trailSegments: SceneObject[] = [];
  private visibleTrailSegments = 0;
  private playerAngle = 0;
  private hazardRotation = 0;
  private coveredDistance = 0;
  private isJumping = false;
  private jumpElapsed = 0;
  private state: "ready" | "playing" | "gameOver" | "complete" = "ready";

  // Cached ScreenTransforms and Text, so hot per-frame paths avoid lookups.
  private playerTransform: ScreenTransform = null;
  private hazardTransforms: ScreenTransform[] = [];
  private gameOverText: Text = null;

  onAwake() {
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    this.createEvent("TapEvent").bind(this.onTap.bind(this));
    this.cacheReferences();
    this.createProgressTrail();
    this.applySizes();
    this.prepareStartScreen();
  }

  private cacheReferences() {
    this.playerTransform = this.getScreenTransform(this.player);

    this.hazards = this.collectHazards();
    this.hazardTransforms = this.hazards.map((hazard) => this.getScreenTransform(hazard));

    if (this.gameOverUI) {
      this.gameOverText = this.gameOverUI.getComponent("Component.Text") as Text;
    }
  }

  private collectHazards(): SceneObject[] {
    const assigned = [this.hazardOne, this.hazardTwo, this.hazardThree].filter(
      (object) => !!object
    ) as SceneObject[];
    if (assigned.length > 0) return assigned;

    // Fallback: find direct children by name.
    const container = this.getSceneObject();
    const found: SceneObject[] = [];
    for (let index = 0; index < container.getChildrenCount(); index++) {
      const child = container.getChild(index);
      if (child.name.indexOf("Obstacle Demon") === 0) found.push(child);
    }
    return found;
  }

  private getScreenTransform(object: SceneObject): ScreenTransform {
    if (!object) return null;
    return object.getComponent("Component.ScreenTransform") as ScreenTransform;
  }

  private onTap() {
    if (this.state !== "playing") {
      this.startGame();
    } else if (!this.isJumping) {
      this.isJumping = true;
      this.jumpElapsed = 0;
    }
  }

  private onUpdate() {
    if (this.state !== "playing") return;

    const deltaTime = getDeltaTime();
    const playerStep = this.playerSpeed * deltaTime;
    this.playerAngle = this.wrapAngle(this.playerAngle + playerStep);
    this.hazardRotation = this.wrapAngle(this.hazardRotation - this.hazardSpeed * deltaTime);
    this.coveredDistance = Math.min(this.fullCircle, this.coveredDistance + playerStep);

    const playerRadius = this.getPlayerRadius(deltaTime);
    this.placeOnRing(this.playerTransform, this.player, this.playerAngle, playerRadius, true);
    this.placeHazards();
    this.revealProgressTrail();
    this.updateRingCoverage();

    if (this.hasCollided(playerRadius)) {
      this.endGame();
    } else if (this.coveredDistance >= this.fullCircle) {
      this.state = "complete";
      this.showMessage("RING COMPLETE!\nTAP TO RESTART");
    }
  }

  private getPlayerRadius(deltaTime: number): number {
    if (!this.isJumping) return this.ringRadius;

    this.jumpElapsed += deltaTime;
    const progress = this.jumpDuration > 0 ? this.jumpElapsed / this.jumpDuration : 1;
    if (progress >= 1) {
      this.isJumping = false;
      this.jumpElapsed = 0;
      return this.ringRadius;
    }

    // Parabola peaking at t = 0.5: 0 -> 1 -> 0 over the jump.
    const t = Math.max(0, progress);
    const parabola = 4.0 * t * (1.0 - t);
    return this.ringRadius - parabola * this.jumpDepth;
  }

  private placeHazards() {
    for (let index = 0; index < this.hazards.length; index++) {
      this.placeOnRing(
        this.hazardTransforms[index],
        this.hazards[index],
        this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]),
        this.ringRadius,
        false
      );
    }
  }

  private hasCollided(playerRadius: number): boolean {
    // Only a jump that goes deep enough can touch a thorn, and only if it is still close to the track.
    if (this.ringRadius - playerRadius >= this.safeJumpDepth) return false;
    if (Math.abs(playerRadius - this.ringRadius) > this.collisionRadius) return false;

    const angularThreshold = this.collisionAngleDegrees * this.degToRad;
    for (let index = 0; index < this.hazards.length; index++) {
      const angle = this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]);
      if (this.angularDistance(this.playerAngle, angle) < angularThreshold) return true;
    }
    return false;
  }

  private placeOnRing(
    transform: ScreenTransform,
    object: SceneObject,
    angle: number,
    radius: number,
    isPlayer: boolean
  ) {
    if (!transform || !object) return;

    transform.anchors.setCenter(
      new vec2(Math.cos(angle) * radius * this.horizontalRadiusMultiplier, Math.sin(angle) * radius)
    );
    const rotationDeg = (angle + (isPlayer ? Math.PI / 2 : -Math.PI / 2)) * this.radToDeg;
    object.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, rotationDeg * this.degToRad));
  }

  private updateRingCoverage() {
    if (!this.ringMaterial) return;
    (this.ringMaterial.mainPass as any).coverage = this.coveredDistance / this.fullCircle;
  }

  private createProgressTrail() {
    if (!this.player || this.trailSegmentCount < 1) return;

    const container = this.getSceneObject();
    const count = Math.floor(this.trailSegmentCount);
    const startAngle = this.startAngleDegrees * this.degToRad;

    for (let index = 0; index < count; index++) {
      const segment = container.copyWholeHierarchy(this.player);
      segment.name = "Progress Trail Segment";
      segment.enabled = false;

      const transform = this.getScreenTransform(segment);
      if (transform) {
        transform.anchors.setSize(new vec2(this.trailSegmentLength, this.trailThickness));
      }

      const angle = startAngle + ((index + 0.5) / count) * this.fullCircle;
      this.placeOnRing(transform, segment, angle, this.ringRadius, true);

      const image = segment.getComponentInDescendants("Component.Image") as Image;
      if (image) (image as any).renderOrder = -1;

      this.trailSegments.push(segment);
    }
  }

  private revealProgressTrail() {
    const total = this.trailSegments.length;
    // Round up so a segment appears as soon as any of its arc is covered.
    const targetCount = Math.min(total, Math.ceil((this.coveredDistance / this.fullCircle) * total));

    while (this.visibleTrailSegments < targetCount) {
      this.trailSegments[this.visibleTrailSegments].enabled = true;
      this.visibleTrailSegments++;
    }
  }

  private resetRound() {
    this.playerAngle = this.startAngleDegrees * this.degToRad;
    this.hazardRotation = 0;
    this.coveredDistance = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;

    for (let index = 0; index < this.trailSegments.length; index++) {
      this.trailSegments[index].enabled = false;
    }
    this.visibleTrailSegments = 0;

    this.placeOnRing(this.playerTransform, this.player, this.playerAngle, this.ringRadius, true);
    this.placeHazards();
    this.updateRingCoverage();
  }

  private prepareStartScreen() {
    this.state = "ready";
    this.resetRound();
    this.showMessage("RING RUNNER\nTAP TO START");
  }

  private startGame() {
    this.state = "playing";
    this.resetRound();
    this.hideMessage();
  }

  private endGame() {
    this.state = "gameOver";
    this.isJumping = false;
    this.showMessage("OH NO, YOU FAILED!\n\n[ RETRY ]");
  }

  // Apply demon sizes once, not on every round start.
  private applySizes() {
    this.setActorSize(this.playerTransform);
    for (let index = 0; index < this.hazardTransforms.length; index++) {
      this.setActorSize(this.hazardTransforms[index]);
    }
  }

  private setActorSize(transform: ScreenTransform) {
    if (transform) {
      transform.anchors.setSize(new vec2(this.demonSize, this.demonSize));
    }
  }

  private showMessage(message: string) {
    if (!this.gameOverUI) return;
    if (this.gameOverText) this.gameOverText.text = message;
    this.gameOverUI.enabled = true;
  }

  private hideMessage() {
    if (this.gameOverUI) this.gameOverUI.enabled = false;
  }

  private wrapAngle(angle: number): number {
    const wrapped = angle % this.fullCircle;
    return wrapped < 0 ? wrapped + this.fullCircle : wrapped;
  }

  private angularDistance(first: number, second: number): number {
    const difference = Math.abs(first - second);
    return Math.min(difference, this.fullCircle - difference);
  }
}