// Ring Runner: circular runner (polar motion), tap-to-jump inward (parabola), clockwise hazards, CCW player.
@component
export class GameController extends BaseScriptComponent {
  @input
  player: SceneObject;

  // Optional hazards. If none are set, we fall back to the legacy `obstacle` input.
  @input
  hazardOne?: SceneObject;

  @input
  hazardTwo?: SceneObject;

  @input
  hazardThree?: SceneObject;

  // Legacy assignment: keeps the current one-hazard scene running.
  @input
  obstacle: SceneObject = null;

  @input
  gameOverUI: SceneObject = null;

  @input
  ringRadius: number = 0.35;

  // Starting angle for the player (degrees). Use this to give more time before the first obstacle.
  @input
  startAngleDegrees: number = 60.0;

  @input
  playerSpeed: number = 1.8;

  @input
  hazardSpeed: number = 0.7;

  @input
  jumpDepth: number = 0.13;

  @input
  jumpDuration: number = 0.42;

  @input
  collisionAngleDegrees: number = 11.0;

  @input
  collisionRadius: number = 0.065;

  @input
  safeJumpDepth: number = 0.065;

  // Diameter of each demon in the ring's parent anchor space.
  @input
  demonSize: number = 0.16;

  // More segments make the ring read as a continuous smooth outline.
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

  // Optional: a material with a float input named "coverage" (0..1) for progress visuals.
  @input
  ringMaterial?: Material;

  private readonly fullCircle = Math.PI * 2;
  // Three equal 120-degree sectors. The player starts midway between the first two.
  private readonly hazardOffsets = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  private hazards: SceneObject[] = [];
  private trailSegments: SceneObject[] = [];
  private progressTrailSegments: SceneObject[] = [];
  private visibleTrailSegments = 0;
  private playerAngle = 0;
  private hazardRotation = 0;
  private coveredDistance = 0;
  private isJumping = false;
  private jumpElapsed = 0;
  private state: "ready" | "playing" | "gameOver" | "complete" = "ready";

  onAwake() {
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    this.createEvent("TapEvent").bind(this.onTap.bind(this));
    this.cacheHazards();
    this.createProgressTrail();
    this.prepareStartScreen();
  }

  private onTap() {
    if (this.state === "ready" || this.state === "gameOver" || this.state === "complete") {
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
    // Hazards rotate clockwise (opposite direction from the player)
    this.hazardRotation = this.wrapAngle(this.hazardRotation - this.hazardSpeed * deltaTime);
    this.coveredDistance = Math.min(this.fullCircle, this.coveredDistance + Math.abs(playerStep));

    const playerRadius = this.getPlayerRadius(deltaTime);
    this.placeOnRing(this.player, this.playerAngle, playerRadius, true);
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

    // Inward jump using a simple parabola (peaks at t=0.5). Depth is max inward distance.
    const t = Math.min(Math.max(progress, 0), 1);
    const parabola = 4.0 * t * (1.0 - t); // 0..1..0
    return this.ringRadius - parabola * this.jumpDepth;
  }

  private placeHazards() {
    for (let index = 0; index < this.hazards.length; index++) {
      this.placeOnRing(this.hazards[index], this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]), this.ringRadius, false);
    }
  }

  private cacheHazards() {
    const assigned = [this.hazardOne, this.hazardTwo, this.hazardThree];
    for (let index = 0; index < assigned.length; index++) {
      if (assigned[index]) this.hazards.push(assigned[index]);
    }

    const gameContainer = this.getSceneObject();
    for (let index = 0; index < gameContainer.getChildrenCount(); index++) {
      const child = gameContainer.getChild(index);
      if (!this.gameOverUI && child.name === "GameOver UI") this.gameOverUI = child;
    }

    if (this.hazards.length === 0) {
      for (let index = 0; index < gameContainer.getChildrenCount(); index++) {
        const child = gameContainer.getChild(index);
        if (child.name.indexOf("Obstacle Demon") === 0) this.hazards.push(child);
      }
    }

    if (this.hazards.length === 0 && this.obstacle) this.hazards.push(this.obstacle);
  }

  private hasCollided(playerRadius: number): boolean {
    if (this.ringRadius - playerRadius >= this.safeJumpDepth) return false;
    if (Math.abs(playerRadius - this.ringRadius) > this.collisionRadius) return false;

    const angularThreshold = this.toRadians(this.collisionAngleDegrees);
    for (let index = 0; index < this.hazards.length; index++) {
      const angle = this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]);
      if (this.angularDistance(this.playerAngle, angle) < angularThreshold) return true;
    }
    return false;
  }

  private placeOnRing(object: SceneObject, angle: number, radius: number, isPlayer: boolean) {
    if (!object) return;
    const screenTransform = object.getComponent("Component.ScreenTransform") as ScreenTransform;
    if (!screenTransform) return;

    screenTransform.anchors.setCenter(
      new vec2(Math.cos(angle) * radius * this.horizontalRadiusMultiplier, Math.sin(angle) * radius)
    );
    const rotation = this.toDegrees(angle + (isPlayer ? Math.PI / 2 : -Math.PI / 2));
    object.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, rotation));
  }

  private updateRingCoverage() {
    if (this.ringMaterial) (this.ringMaterial.mainPass as any).coverage = this.coveredDistance / this.fullCircle;
  }

  private createProgressTrail() {
    if (!this.player || this.trailSegmentCount < 1) return;

    const gameContainer = this.getSceneObject();
    const count = Math.floor(this.trailSegmentCount);
    const startAngle = this.toRadians(this.startAngleDegrees);

    for (let index = 0; index < count; index++) {
      // Copying the player hierarchy preserves its existing screen Image and material.
      const segment = gameContainer.copyWholeHierarchy(this.player);
      segment.name = "Progress Trail Segment";
      segment.enabled = false;

      const angle = startAngle + ((index + 0.5) / count) * this.fullCircle;
      const screenTransform = segment.getComponent("Component.ScreenTransform") as ScreenTransform;
      if (screenTransform) {
        screenTransform.anchors.setSize(new vec2(this.trailSegmentLength, this.trailThickness));
      }
      this.placeOnRing(segment, angle, this.ringRadius, true);

      // Keep the thin trail visually behind the demons on renderers that use sort order.
      const image = segment.getComponentInDescendants("Component.Image") as Image;
      if (image) (image as any).renderOrder = -1;

      this.trailSegments.push(segment);
    }
  }

  private revealProgressTrail() {
    const targetCount = Math.min(
      this.trailSegments.length,
      Math.floor((this.coveredDistance / this.fullCircle) * this.trailSegments.length)
    );

    while (this.visibleTrailSegments < targetCount) {
      this.trailSegments[this.visibleTrailSegments].enabled = true;
      this.visibleTrailSegments++;
    }
  }

  private resetProgressTrail() {
    for (let index = 0; index < this.trailSegments.length; index++) {
      this.trailSegments[index].enabled = false;
    }
    this.visibleTrailSegments = 0;
  }

  private prepareStartScreen() {
    this.state = "ready";
    this.playerAngle = this.toRadians(this.startAngleDegrees);
    this.hazardRotation = 0;
    this.coveredDistance = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;
    this.resizeActors();
    this.resetProgressTrail();
    this.placeOnRing(this.player, this.playerAngle, this.ringRadius, true);
    this.placeHazards();
    this.updateRingCoverage();
    this.showMessage("RING RUNNER\nTAP TO START");
  }

  private startGame() {
    this.state = "playing";
    this.playerAngle = this.toRadians(this.startAngleDegrees);
    this.hazardRotation = 0;
    this.coveredDistance = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;
    this.resizeActors();
    this.resetProgressTrail();
    this.placeOnRing(this.player, this.playerAngle, this.ringRadius, true);
    this.placeHazards();
    this.updateRingCoverage();
    this.hideMessage();
  }

  private endGame() {
    this.state = "gameOver";
    this.isJumping = false;
    this.showMessage("OH NO, YOU FAILED!\n\n[ RETRY ]");
  }

  private resizeActors() {
    this.setActorSize(this.player);
    for (let index = 0; index < this.hazards.length; index++) {
      this.setActorSize(this.hazards[index]);
    }
  }

  private setActorSize(object: SceneObject) {
    if (!object) return;
    const screenTransform = object.getComponent("Component.ScreenTransform") as ScreenTransform;
    if (screenTransform) {
      screenTransform.anchors.setSize(new vec2(this.demonSize, this.demonSize));
    }
  }

  private showMessage(message: string) {
    if (!this.gameOverUI) return;
    const text = this.gameOverUI.getComponent("Component.Text") as Text;
    if (text) text.text = message;
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

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }

  private toDegrees(radians: number): number {
    return (radians * 180) / Math.PI;
  }
}
