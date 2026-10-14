// Ring Runner: polar-motion runner on a fixed ring. The player jumps inward
// on a parabolic arc; thorn demons circle the ring in the opposite direction.
// Progress is shown as a pink trail that fills the ring as the player travels.
@component
export class GameController extends BaseScriptComponent {
  // --- GAMEPLAY & SPEEDS ---
  @input playerSpeed: number = 1.0; // Reduced from 1.8 for fair reaction time
  @input hazardSpeed: number = 0.4; // Reduced from 0.7
  @input jumpDuration: number = 0.65; // Slightly longer air-time
  @input jumpDepth: number = 0.13;
  @input startAngleDegrees: number = 60.0;

  // --- SIZES & HITBOXES ---
  @input ringRadius: number = 0.35;
  @input demonSize: number = 0.16;
  @input collisionRadius: number = 0.055;
  @input safeJumpDepth: number = 0.065;
  @input collisionAngleDegrees: number = 15.0; // Slightly more forgiving hitbox
  @input horizontalRadiusMultiplier: number = 1.78;

  // --- TRAIL CONFIGURATION ---
  @input trailSegmentCount: number = 96;
  @input trailSegmentLength: number = 0.04;
  @input trailThickness: number = 0.028;

  // --- COLORS ---
  @input playerColor: vec4 = new vec4(1.0, 0.2, 0.8, 1.0);
  @input hazardColor: vec4 = new vec4(1.0, 0.25, 0.2, 1.0);
  @input trailColor: vec4 = new vec4(1.0, 0.2, 0.8, 1.0); // Pink when covered
  @input trackColor: vec4 = new vec4(0.3, 0.3, 0.35, 1.0); // Dim gray when unpainted

  // --- SCENE REFERENCES ---
  @input player: SceneObject;
  @input hazardOne?: SceneObject;
  @input hazardTwo?: SceneObject;
  @input hazardThree?: SceneObject;
  @input gameOverUI: SceneObject = null;
  @input ringMaterial?: Material;

  private readonly fullCircle = Math.PI * 2;
  private readonly hazardOffsets = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  private readonly degToRad = Math.PI / 180;
  private readonly radToDeg = 180 / Math.PI;

  private hazards: SceneObject[] = [];
  private trailSegments: SceneObject[] = [];
  private segmentCovered: boolean[] = [];
  private trailImages: (Image | null)[] = [];
  private trackMaterial: Material = null;
  private paintMaterial: Material = null;

  private coveredCount = 0;
  private playerAngle = 0;
  private hazardRotation = 0;
  private isJumping = false;
  private jumpElapsed = 0;
  private state: "ready" | "playing" | "gameOver" | "complete" = "ready";

  // Cached ScreenTransforms and Text
  private playerTransform: ScreenTransform = null;
  private hazardTransforms: ScreenTransform[] = [];
  private gameOverText: Text = null;

  onAwake() {
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this));
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    this.createEvent("TapEvent").bind(this.onTap.bind(this));
    this.cacheReferences();
    this.createProgressTrail();
    this.applySizes();
  }

  private onStart() {
    this.prepareStartScreen();
  }

  private cacheReferences() {
    this.playerTransform = this.getScreenTransform(this.player);
    this.tintEntity(this.player, this.playerColor);

    this.hazards = this.collectHazards();
    this.hazardTransforms = this.hazards.map((hazard) => this.getScreenTransform(hazard));
    for (let index = 0; index < this.hazards.length; index++) {
      this.tintEntity(this.hazards[index], this.hazardColor);
    }

    if (this.gameOverUI) {
      this.gameOverText = this.gameOverUI.getComponent("Component.Text") as Text;
    } else {
      this.createDefaultUI();
    }
  }

  private createDefaultUI() {
    this.gameOverUI = global.scene.createSceneObject("Auto UI");
    this.gameOverUI.setParent(this.getSceneObject());

    const screenTransform = this.gameOverUI.createComponent("Component.ScreenTransform") as ScreenTransform;
    screenTransform.anchors.setCenter(vec2.zero());
    screenTransform.anchors.setSize(new vec2(1, 1));

    this.gameOverText = this.gameOverUI.createComponent("Component.Text") as Text;
    this.gameOverText.horizontalAlignment = 0; // Center
    this.gameOverText.verticalAlignment = 1; // Center

    // Default text color and size
    this.gameOverText.textFill.color = new vec4(1, 1, 1, 1);
    this.gameOverText.size = 48;
    this.gameOverText.outlineSettings.fill.color = new vec4(0, 0, 0, 1);
    this.gameOverText.outlineSettings.size = 0.5;
  }

  private collectHazards(): SceneObject[] {
    const assigned = [this.hazardOne, this.hazardTwo, this.hazardThree].filter(
      (object) => !!object
    ) as SceneObject[];

    let found = assigned;

    // Fallback: find direct children by name if none assigned
    if (found.length === 0) {
      const container = this.getSceneObject();
      for (let index = 0; index < container.getChildrenCount(); index++) {
        const child = container.getChild(index);
        if (child.name.indexOf("Obstacle Demon") === 0) found.push(child);
      }
    }

    // Auto-clone to ensure exactly 3 hazards exist for the game loop
    if (found.length > 0 && found.length < 3) {
      const container = this.getSceneObject();
      const source = found[0];
      while (found.length < 3) {
        const clone = container.copyWholeHierarchy(source);
        clone.name = "Obstacle Demon Clone";
        found.push(clone);
      }
    }

    return found;
  }

  // Safely finds the Image component wherever it lives (root or child)
  private getImage(object: SceneObject): Image {
    if (!object) return null;
    let img = object.getComponent("Component.Image") as Image;
    if (!img) img = object.getComponentInDescendants("Component.Image") as Image;
    return img;
  }

  private tintEntity(object: SceneObject, color: vec4) {
    const image = this.getImage(object);
    if (!image || !image.mainMaterial) return;

    const material = image.mainMaterial.clone();
    material.mainPass.baseColor = color;
    image.mainMaterial = material;
  }

  private getScreenTransform(object: SceneObject): ScreenTransform {
    if (!object) return null;
    return object.getComponent("Component.ScreenTransform") as ScreenTransform;
  }

  private makeMaterialCopy(color: vec4, source: SceneObject): Material {
    const image = this.getImage(source);
    if (!image || !image.mainMaterial) {
      print("GameController Error: Could not find Image on source object to copy material.");
      return null;
    }
    const material = image.mainMaterial.clone();
    material.mainPass.baseColor = color;
    return material;
  }

  private createProgressTrail() {
    if (!this.player || this.trailSegmentCount < 1) return;

    const container = this.getSceneObject();
    const count = Math.floor(this.trailSegmentCount);
    const startAngle = this.startAngleDegrees * this.degToRad;

    this.trackMaterial = this.makeMaterialCopy(this.trackColor, this.player);
    this.paintMaterial = this.makeMaterialCopy(this.trailColor, this.player);

    this.trailImages = [];
    this.trailSegments = [];
    this.segmentCovered = [];

    for (let index = 0; index < count; index++) {
      const segment = container.copyWholeHierarchy(this.player);
      segment.name = "Progress Trail Segment";
      segment.enabled = true;

      const transform = this.getScreenTransform(segment);
      if (transform) {
        // Clear inherited pixel offsets so the size matches anchor settings exactly
        transform.offsets.left = 0;
        transform.offsets.right = 0;
        transform.offsets.top = 0;
        transform.offsets.bottom = 0;
        transform.anchors.setSize(new vec2(this.trailSegmentLength, this.trailThickness));
      }

      const angle = startAngle + ((index + 0.5) / count) * this.fullCircle;
      this.placeOnRing(transform, segment, angle, this.ringRadius, true);

      const image = this.getImage(segment);
      if (image) {
        (image as any).renderOrder = -1; // Push ring visual behind entities
        if (this.trackMaterial) image.mainMaterial = this.trackMaterial;
        this.trailImages.push(image);
      } else {
        this.trailImages.push(null);
      }

      this.trailSegments.push(segment);
      this.segmentCovered.push(false);
    }
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
    this.playerAngle = this.wrapAngle(this.playerAngle + this.playerSpeed * deltaTime);
    this.hazardRotation = this.wrapAngle(this.hazardRotation - this.hazardSpeed * deltaTime);

    const playerRadius = this.getPlayerRadius(deltaTime);
    this.placeOnRing(this.playerTransform, this.player, this.playerAngle, playerRadius, true);
    this.placeHazards();

    if (this.hasCollided(playerRadius)) {
      this.endGame();
      return;
    }

    if (!this.isJumping) {
      this.paintSegmentAt(this.playerAngle);
    }
    this.updateRingCoverage();

    if (this.trailSegments.length > 0 && this.coveredCount >= this.trailSegments.length) {
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

    transform.offsets.left = 0;
    transform.offsets.right = 0;
    transform.offsets.top = 0;
    transform.offsets.bottom = 0;

    transform.anchors.setCenter(
      new vec2(Math.cos(angle) * radius * this.horizontalRadiusMultiplier, Math.sin(angle) * radius)
    );
    const rotationDeg = (angle + (isPlayer ? Math.PI / 2 : -Math.PI / 2)) * this.radToDeg;
    object.getTransform().setLocalRotation(quat.fromEulerAngles(0, 0, rotationDeg * this.degToRad));
  }

  private updateRingCoverage() {
    if (!this.ringMaterial || this.trailSegments.length === 0) return;
    (this.ringMaterial.mainPass as any).coverage = this.coveredCount / this.trailSegments.length;
  }

  private paintSegmentAt(angle: number) {
    const total = this.trailSegments.length;
    if (total === 0) return;

    const offset = this.wrapAngle(angle - this.startAngleDegrees * this.degToRad);
    const index = Math.min(total - 1, Math.floor((offset / this.fullCircle) * total));
    if (this.segmentCovered[index]) return;

    this.segmentCovered[index] = true;
    const image = this.trailImages[index];
    if (image && this.paintMaterial) {
      image.mainMaterial = this.paintMaterial;
    }
    this.coveredCount++;
  }

  private resetRound() {
    this.playerAngle = this.startAngleDegrees * this.degToRad;
    this.hazardRotation = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;
    this.coveredCount = 0;

    for (let index = 0; index < this.trailSegments.length; index++) {
      this.trailSegments[index].enabled = true;
      this.segmentCovered[index] = false;

      const image = this.trailImages[index];
      if (image && this.trackMaterial) {
        image.mainMaterial = this.trackMaterial;
      }
    }

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
    this.paintSegmentAt(this.playerAngle);
    this.updateRingCoverage();
    this.hideMessage();
  }

  private endGame() {
    this.state = "gameOver";
    this.isJumping = false;
    this.showMessage("OH NO, YOU FAILED!\n\n[ RETRY ]");
  }

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