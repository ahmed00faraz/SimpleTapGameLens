// Ring Runner: polar-motion runner on a fixed ring. The player jumps inward
// on a parabolic arc; thorn demons circle the ring in the opposite direction.
// Progress is a pink arc that grows from spawn until the ring is fully pink.
@component
export class GameController extends BaseScriptComponent {
  @input
  player: SceneObject;

  @input
  hazardOne?: SceneObject;

  @input
  hazardTwo?: SceneObject;

  @input
  hazardThree?: SceneObject;

  @input
  gameOverUI: SceneObject = null;

  @input
  ring?: SceneObject;

  @input
  ringRadius: number = 0.35;

  @input
  startAngleDegrees: number = 180.0;

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

  // A jump at least this deep (inward from the ring) clears thorns.
  @input
  safeJumpDepth: number = 0.065;

  // Diameter of each demon in the ring's parent anchor space.
  @input
  demonSize: number = 0.16;

  @input
  ringThickness: number = 0.05;

  // Portrait ScreenTransforms use a narrower X axis than Y axis.
  @input
  horizontalRadiusMultiplier: number = 1.78;

  // Material with a float input named "coverage" (0..1). Optional.
  @input
  ringMaterial?: Material;

  @input
  trailMaterial?: Material;

  private readonly fullCircle = Math.PI * 2;
  private readonly hazardOffsets = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
  private readonly degToRad = Math.PI / 180;
  private readonly radToDeg = 180 / Math.PI;
  private readonly ringTexSize = 128;
  private readonly unpaintedRgba = [235, 38, 46, 255];
  private readonly paintedRgba = [255, 89, 184, 255];

  private hazards: SceneObject[] = [];
  private playerAngle = 0;
  private hazardRotation = 0;
  private isJumping = false;
  private jumpElapsed = 0;
  private travelled = 0;
  private coverage = 0;
  private lastDrawnCoverage = -1;
  private state: "ready" | "playing" | "gameOver" | "complete" = "ready";

  private playerTransform: ScreenTransform = null;
  private playerLocalTransform: Transform = null;
  private hazardTransforms: ScreenTransform[] = [];
  private hazardLocalTransforms: Transform[] = [];
  private ringTransform: ScreenTransform = null;
  private ringImage: Image = null;
  private gameOverText: Text = null;

  private ringPixels: Uint8Array = null;
  private ringTexture: Texture = null;
  private useProceduralRing = false;
  private coverageSegments: SceneObject[] = [];
  private coverageSegmentCount = 64;

  onAwake() {
    this.createEvent("OnStartEvent").bind(this.onStart.bind(this));
    this.createEvent("UpdateEvent").bind(this.onUpdate.bind(this));
    this.createEvent("TapEvent").bind(this.onTap.bind(this));
    this.cacheReferences();
    this.applySizes();
    this.layoutRing();
    this.initCoverageVisual();
  }

  private onStart() {
    this.prepareStartScreen();
  }

  private cacheReferences() {
    this.playerTransform = this.getScreenTransform(this.player);
    this.playerLocalTransform = this.player ? this.player.getTransform() : null;

    this.hazards = this.collectHazards();
    this.hazardTransforms = [];
    this.hazardLocalTransforms = [];
    for (let index = 0; index < this.hazards.length; index++) {
      this.hazardTransforms.push(this.getScreenTransform(this.hazards[index]));
      this.hazardLocalTransforms.push(this.hazards[index].getTransform());
    }

    const ringObject = this.ring || this.findChildByName("Ring");
    if (ringObject) {
      this.ringTransform = this.getScreenTransform(ringObject);
      this.ringImage = ringObject.getComponentInDescendants("Component.Image") as Image;
      if (!this.ringMaterial && this.ringImage) {
        this.ringMaterial = this.ringImage.mainMaterial;
      }
    }

    if (this.gameOverUI) {
      this.gameOverText = this.gameOverUI.getComponent("Component.Text") as Text;
    }
    if (!this.gameOverText) {
      print("GameController: 'GameOver UI' needs a Text component; title and result messages will not show.");
    }
  }

  private findChildByName(name: string): SceneObject {
    const container = this.getSceneObject();
    for (let index = 0; index < container.getChildrenCount(); index++) {
      const child = container.getChild(index);
      if (child.name === name) return child;
    }
    return null;
  }

  private collectHazards(): SceneObject[] {
    const assigned = [this.hazardOne, this.hazardTwo, this.hazardThree].filter(
      (object) => !!object
    ) as SceneObject[];
    if (assigned.length > 0) return assigned;

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
    const deltaAngle = this.playerSpeed * deltaTime;
    this.playerAngle = this.wrapAngle(this.playerAngle + deltaAngle);
    this.hazardRotation = this.wrapAngle(this.hazardRotation - this.hazardSpeed * deltaTime);
    this.travelled += deltaAngle;
    this.coverage = Math.min(1, this.travelled / this.fullCircle);

    const playerRadius = this.getPlayerRadius(deltaTime);
    this.placeOnRing(
      this.playerTransform,
      this.playerLocalTransform,
      this.playerAngle,
      playerRadius,
      true
    );
    this.placeHazards();

    if (this.hasCollided(playerRadius)) {
      this.endGame();
      return;
    }

    this.updateRingCoverage();

    if (this.coverage >= 1) {
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
        this.hazardLocalTransforms[index],
        this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]),
        this.ringRadius,
        false
      );
    }
  }

  private hasCollided(playerRadius: number): boolean {
    if (this.ringRadius - playerRadius >= this.safeJumpDepth) return false;

    const angularThreshold = this.collisionAngleDegrees * this.degToRad;
    for (let index = 0; index < this.hazards.length; index++) {
      const angle = this.wrapAngle(this.hazardRotation + this.hazardOffsets[index]);
      if (this.angularDistance(this.playerAngle, angle) < angularThreshold) return true;
    }
    return false;
  }

  private placeOnRing(
    transform: ScreenTransform,
    localTransform: Transform,
    angle: number,
    radius: number,
    isPlayer: boolean
  ) {
    if (!transform) return;

    transform.anchors.setCenter(
      new vec2(Math.cos(angle) * radius * this.horizontalRadiusMultiplier, Math.sin(angle) * radius)
    );
    if (!localTransform) return;
    const rotationRad = angle + (isPlayer ? Math.PI / 2 : -Math.PI / 2);
    localTransform.setLocalRotation(quat.fromEulerAngles(0, 0, rotationRad));
  }

  private layoutRing() {
    if (!this.ringTransform) return;
    const pad = this.ringThickness * 0.5 + 0.02;
    this.ringTransform.anchors.setCenter(new vec2(0, 0));
    this.ringTransform.anchors.setSize(
      new vec2(
        (this.ringRadius + pad) * 2 * this.horizontalRadiusMultiplier,
        (this.ringRadius + pad) * 2
      )
    );
  }

  private initCoverageVisual() {
    const provider = (global as any).ProceduralTextureProvider;
    if (provider && this.ringImage) {
      try {
        this.ringPixels = new Uint8Array(this.ringTexSize * this.ringTexSize * 4);
        this.ringTexture = provider.create(this.ringTexSize, this.ringTexSize, Colorspace.RGBA);
        this.useProceduralRing = !!this.ringTexture;
        if (this.useProceduralRing) {
          this.paintProceduralRing(0);
          this.applyRingTexture();
          return;
        }
      } catch (error) {
        this.useProceduralRing = false;
      }
    }
    this.createCoverageSegments();
  }

  private applyRingTexture() {
    if (!this.ringImage || !this.ringTexture) return;
    const material = this.ringMaterial || this.ringImage.mainMaterial;
    if (!material) return;
    const pass = material.mainPass as any;
    pass.baseTex = this.ringTexture;
    pass.coverage = this.coverage;
  }

  private paintProceduralRing(coverage: number) {
    const n = this.ringTexSize;
    const pixels = this.ringPixels;
    const start = this.startAngleDegrees * this.degToRad;
    const outer = 0.49;
    const inner = Math.max(0.05, outer - this.ringThickness / Math.max(0.001, this.ringRadius * 2) * 0.5);
    const red = this.unpaintedRgba;
    const pink = this.paintedRgba;

    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const dx = (x + 0.5) / n - 0.5;
        const dy = 0.5 - (y + 0.5) / n;
        const radius = Math.sqrt(dx * dx + dy * dy);
        if (radius < inner || radius > outer) {
          pixels[i] = 0;
          pixels[i + 1] = 0;
          pixels[i + 2] = 0;
          pixels[i + 3] = 0;
          continue;
        }
        const angle = Math.atan2(dy, dx);
        const offset = this.wrapAngle(angle - start);
        const painted = coverage > 0 && offset / this.fullCircle <= coverage + 0.0001;
        const color = painted ? pink : red;
        pixels[i] = color[0];
        pixels[i + 1] = color[1];
        pixels[i + 2] = color[2];
        pixels[i + 3] = color[3];
      }
    }

    const control = this.ringTexture.control as any;
    if (control && control.setPixels) {
      control.setPixels(0, 0, n, n, pixels);
    }
    this.lastDrawnCoverage = coverage;
  }

  private createCoverageSegments() {
    const container = this.getSceneObject();
    const count = this.coverageSegmentCount;
    const startAngle = this.startAngleDegrees * this.degToRad;
    const length = (this.fullCircle * this.ringRadius) / count + 0.006;
    const thickness = this.ringThickness;

    for (let index = 0; index < count; index++) {
      const segment = global.scene.createSceneObject("Coverage Segment");
      segment.setParent(container);
      segment.enabled = true;

      const transform = segment.createComponent("Component.ScreenTransform") as ScreenTransform;
      if (transform) {
        transform.anchors.setSize(new vec2(length, thickness));
      }

      const image = segment.createComponent("Component.Image") as Image;
      if (image) {
        (image as any).renderOrder = -1;
        if (this.trailMaterial) {
          image.mainMaterial = this.trailMaterial;
        } else if (this.ringMaterial) {
          image.mainMaterial = this.ringMaterial;
        }
      }

      const angle = startAngle + ((index + 0.5) / count) * this.fullCircle;
      this.placeOnRing(transform, segment.getTransform(), angle, this.ringRadius, true);
      segment.enabled = false;
      this.coverageSegments.push(segment);
    }
  }

  private updateRingCoverage() {
    if (this.ringMaterial) {
      (this.ringMaterial.mainPass as any).coverage = this.coverage;
    }

    if (this.useProceduralRing) {
      if (Math.abs(this.coverage - this.lastDrawnCoverage) < 0.004 && this.coverage < 1) return;
      this.paintProceduralRing(this.coverage);
      return;
    }

    const total = this.coverageSegments.length;
    if (total === 0) return;
    const painted = Math.min(total, Math.floor(this.coverage * total + 0.0001));
    for (let index = 0; index < total; index++) {
      this.coverageSegments[index].enabled = index < painted;
    }
  }

  private resetRound() {
    this.playerAngle = this.startAngleDegrees * this.degToRad;
    this.hazardRotation = 0;
    this.isJumping = false;
    this.jumpElapsed = 0;
    this.travelled = 0;
    this.coverage = 0;

    this.placeOnRing(
      this.playerTransform,
      this.playerLocalTransform,
      this.playerAngle,
      this.ringRadius,
      true
    );
    this.placeHazards();
    this.updateRingCoverage();
    if (this.useProceduralRing) {
      this.paintProceduralRing(0);
    }
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
