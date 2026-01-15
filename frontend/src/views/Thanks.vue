<template>
  <div ref="containerRef" class="thanks-container">
    <div ref="titleRef" class="title">感谢Ta们对项目的赞赏</div>

    <!-- 添加说明文字 -->
    <div class="description">
      <p>感谢每一位支持者的信任与鼓励</p>
      <p>正是你们的支持让这个项目能够持续发展</p>
    </div>

    <div ref="sponsorsContainer" class="sponsors-container">
      <div
        v-for="(sponsor, index) in randomizedSponsors"
        :key="sponsor.name"
        ref="avatarRefs"
        class="sponsor-avatar"
        @mouseenter="handleMouseEnter(index)"
        @mouseleave="handleMouseLeave"
      >
        <div
          ref="avatarWrapperRefs"
          class="avatar-wrapper"
          :class="{
            active: activeIndex === index,
            'has-link': sponsor.link,
          }"
          @click="handleAvatarClick(sponsor.link)"
        >
          <div class="avatar-inner">
            <div class="avatar-overlay"></div>
            <img :src="sponsor.avatar" :alt="sponsor.name" class="avatar-img" />
            <div class="name-tag">
              {{ sponsor.name }}
            </div>
          </div>
        </div>

        <div v-if="activeIndex === index && sponsor.message" class="dialog-box">
          <div class="dialog-content">
            <div :id="`typeIt-${index}`" class="type-it-container"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加赞赏按钮 -->
    <a
      :href="PROJECT_GITHUB + '?tab=readme-ov-file#支持项目'"
      target="_blank"
      class="sponsor-button"
      @mouseenter="handleButtonHover"
      @mouseleave="handleButtonLeave"
    >
      <div class="button-content">
        <svg class="heart-icon" viewBox="0 0 24 24">
          <path
            d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          />
        </svg>
        <span>赞赏支持</span>
      </div>
    </a>
  </div>
</template>

<script setup>
import { ref, onMounted, nextTick, computed, onBeforeUnmount } from "vue";
import TypeIt from "typeit";
import { userApi } from "@/api/user";
import gsap from "gsap";
import { PROJECT_GITHUB } from "@/constants/project";
// 赞助者数据
const sponsors = ref([]);

const getSponsors = async () => {
  const res = await userApi.getSponsors();
  sponsors.value = res.data;
};

// 随机排序赞助者
const randomizedSponsors = computed(() => {
  // 有sort的按照sort排序并排在前面，没有的按照随机排序
  const sortedSponsors = [...sponsors.value]
    .filter((item) => item.sort)
    .sort((a, b) => a.sort - b.sort);
  const randomSponsors = [...sponsors.value]
    .filter((item) => !item.sort)
    .sort(() => Math.random() - 0.5);
  return [...sortedSponsors, ...randomSponsors];
});

const containerRef = ref(null);
const sponsorsContainer = ref(null);
const activeIndex = ref(null);
const avatarRefs = ref([]);
const avatarWrapperRefs = ref([]);
let typeItInstance = null;
const activeCenter = ref({ x: 0, y: 0 });
const titleRef = ref(null);

// 添加头像动画时间轴的引用
const avatarTimelines = ref([]);

// 使用 requestAnimationFrame 优化动画更新
let rafId = null;

// 添加一个变量来跟踪当前激活的头像
let currentHoverIndex = null;

onMounted(async () => {
  await getSponsors();

  // 修改页面入场动画
  const tl = gsap.timeline({
    defaults: { ease: "power3.out" },
  });

  // 同时执行所有元素的动画
  tl.from([titleRef.value, sponsorsContainer.value, ...avatarWrapperRefs.value], {
    y: -20,
    opacity: 0,
    duration: 0.6,
    stagger: {
      amount: 0.3,
      from: "start",
    },
    ease: "back.out(1.2)",
  });

  // 添加可见性变化监听
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // 添加窗口失焦事件处理
  window.addEventListener("blur", handleMouseLeave);
});

// 修改 handleVisibilityChange 函数
const handleVisibilityChange = () => {
  if (document.hidden) {
    // 页面不可见时清理资源
    if (typeItInstance) {
      typeItInstance.destroy();
      typeItInstance = null;
    }
  }
};

// 修改鼠标移入处理函数
const handleMouseEnter = (() => {
  let timeout;
  return async (index) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    currentHoverIndex = index;
    activeIndex.value = index;

    timeout = setTimeout(async () => {
      // 确保这是最新的hover状态
      if (currentHoverIndex !== index) return;

      const activeAvatar = avatarWrapperRefs.value[index];
      if (activeAvatar) {
        const rect = activeAvatar.getBoundingClientRect();
        activeCenter.value = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }

      // 暂停所有浮动动画
      avatarTimelines.value.forEach((timeline) => {
        if (timeline) {
          timeline.pause();
        }
      });

      updateAvatarsEffect(index);

      await nextTick();

      try {
        // 初始化打字效果
        if (typeItInstance) {
          typeItInstance.destroy();
          typeItInstance = null;
        }

        const typeItElement = document.getElementById(`typeIt-${index}`);
        if (typeItElement) {
          typeItInstance = new TypeIt(typeItElement, {
            strings: randomizedSponsors.value[index].message,
            speed: 20,
            waitUntilVisible: true,
          }).go();
        }
      } catch (error) {
        console.error("TypeIt初始化错误:", error);
      }
    }, 16);
  };
})();

// 更新所有头像效果
const updateAvatarsEffect = (activeIndex) => {
  if (!avatarWrapperRefs.value || activeCenter.value.x === 0) return;

  if (rafId) {
    cancelAnimationFrame(rafId);
  }

  rafId = requestAnimationFrame(() => {
    avatarWrapperRefs.value.forEach((wrapper, index) => {
      const inner = wrapper.querySelector(".avatar-inner");
      const avatarContainer = wrapper.closest(".sponsor-avatar");

      if (index === activeIndex) {
        gsap.to(inner, {
          scale: 1.2,
          y: -15,
          zIndex: 10,
          duration: 0.2,
          ease: "back.out(1.5)",
          force3D: true,
        });

        gsap.to(avatarContainer, {
          filter: "drop-shadow(0 20px 30px rgba(0, 0, 0, 0.25))",
          duration: 0.2,
        });

        const activeOverlay = wrapper.querySelector(".avatar-overlay");
        gsap.to(activeOverlay, {
          opacity: 0,
          duration: 0.15,
        });
        return;
      }

      const rect = wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = activeCenter.value.x - centerX;
      const deltaY = activeCenter.value.y - centerY;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

      if (distance < 0.1) return;

      const maxDistance = 400;
      const strength = Math.max(0, 1 - distance / maxDistance);

      // 计算吸引力效果
      const attractionStrength = Math.pow(strength, 1.5);
      const moveX = (deltaX / distance) * 30 * attractionStrength;
      const moveY = (deltaY / distance) * 30 * attractionStrength;

      // 计算旋转角度
      const rotateX = -Math.atan2(deltaY, distance) * (180 / Math.PI) * strength;
      const rotateY = Math.atan2(deltaX, distance) * (180 / Math.PI) * strength;

      // 应用变换效果
      gsap.to(inner, {
        scale: 1 + 0.05 * strength,
        x: moveX,
        y: moveY,
        rotationX: rotateX,
        rotationY: rotateY,
        duration: 0.2,
        ease: "power2.out",
        force3D: true,
      });

      // 更新阴影效果
      const shadowOffsetX = (deltaX / distance) * 15 * strength;
      const shadowOffsetY = Math.max(6, (deltaY / distance) * 20 * strength + 6);
      const shadowBlur = 12 + 18 * strength;
      const shadowOpacity = 0.15 + 0.1 * strength;

      gsap.to(avatarContainer, {
        filter: `drop-shadow(${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity}))`,
        duration: 0.2,
      });
    });
  });
};

// 修改鼠标移出处理函数
const handleMouseLeave = () => {
  currentHoverIndex = null;
  activeIndex.value = null;
  activeCenter.value = { x: 0, y: 0 };

  if (!avatarWrapperRefs.value) return;

  avatarWrapperRefs.value.forEach((wrapper) => {
    const inner = wrapper.querySelector(".avatar-inner");
    if (inner) {
      gsap.killTweensOf(inner);

      gsap.to(inner, {
        scale: 1,
        y: 0,
        x: 0,
        rotation: 0,
        rotationX: 0,
        rotationY: 0,
        duration: 0.2,
        ease: "power2.out",
      });
    }

    const avatarContainer = wrapper.closest(".sponsor-avatar");
    if (avatarContainer) {
      gsap.killTweensOf(avatarContainer);

      gsap.to(avatarContainer, {
        filter: "drop-shadow(0 6px 12px rgba(0, 0, 0, 0.15))",
        duration: 0.2,
      });
    }

    const overlayElement = wrapper.querySelector(".avatar-overlay");
    if (overlayElement) {
      gsap.to(overlayElement, {
        opacity: 1,
        duration: 0.15,
      });
    }
  });

  if (typeItInstance) {
    typeItInstance.destroy();
    typeItInstance = null;
  }
};

// 添加点击处理函数
const handleAvatarClick = (link) => {
  if (link) {
    window.open(link, "_blank");
  }
};

// 组件卸载时清理
onBeforeUnmount(() => {
  window.removeEventListener("blur", handleMouseLeave);
  document.removeEventListener("visibilitychange", handleVisibilityChange);

  // 清理打字实例
  if (typeItInstance) {
    typeItInstance.destroy();
    typeItInstance = null;
  }
});

// 添加按钮悬浮效果
const handleButtonHover = () => {
  gsap.to(".sponsor-button", {
    scale: 1.05,
    duration: 0.3,
    ease: "power2.out",
  });
};

const handleButtonLeave = () => {
  gsap.to(".sponsor-button", {
    scale: 1,
    duration: 0.3,
    ease: "power2.out",
  });
};
</script>

<style scoped>
.thanks-container {
  width: 100%;
  box-sizing: border-box;
  height: calc(100vh - 100px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 40px 20px;
  background: linear-gradient(135deg, #f6f8fd 0%, #f1f4f9 100%);
  position: relative;
  z-index: 1;
  transform: translateZ(0);
  will-change: transform;
  backface-visibility: hidden;
}

.gradient-circle {
  position: absolute;
  border-radius: 50%;
  filter: blur(40px);
  opacity: 0.5;
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.circle-1 {
  width: 600px;
  height: 600px;
  background: linear-gradient(45deg, rgba(142, 68, 173, 0.2), rgba(91, 177, 235, 0.2));
  top: -200px;
  left: -200px;
}

.circle-2 {
  width: 500px;
  height: 500px;
  background: linear-gradient(45deg, rgba(91, 177, 235, 0.2), rgba(142, 68, 173, 0.2));
  bottom: -150px;
  right: -150px;
}

.circle-3 {
  width: 400px;
  height: 400px;
  background: linear-gradient(45deg, rgba(241, 196, 15, 0.1), rgba(142, 68, 173, 0.1));
  top: 40%;
  left: 30%;
}

/* 装饰层 */
.decoration-layer {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

.floating-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  background: rgba(142, 68, 173, 0.2);
  border-radius: 50%;
  animation: floatingDot 8s ease-in-out infinite;
  animation-delay: var(--delay);
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

@keyframes floatingDot {
  0%,
  100% {
    transform: translate(0, 0);
  }
  25% {
    transform: translate(100px, 50px);
  }
  50% {
    transform: translate(50px, 100px);
  }
  75% {
    transform: translate(-50px, 50px);
  }
}

.title {
  margin-bottom: 20px;
  font-size: 50px;
  color: #2c3e50;
  text-align: center;
  font-weight: 700;
  background: linear-gradient(45deg, #8e44ad, #3498db);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.1);
  letter-spacing: 1px;
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.sponsors-container {
  width: 70%;
  max-width: 1200px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  grid-gap: 40px;
  justify-content: center;
  padding: 20px;
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform: translateZ(0);
  opacity: 1; /* 确保容器默认可见 */
}

.sponsor-avatar {
  position: relative;
  transform-style: preserve-3d;
  transition: transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: 20px;
  filter: drop-shadow(0 6px 12px rgba(0, 0, 0, 0.15));
  transition: all 0.3s ease;
}

.avatar-wrapper {
  width: 80px;
  height: 80px;
  position: relative;
  z-index: 1;
}

.avatar-inner {
  width: 100% !important;
  height: 100% !important;
  border-radius: 50%;
  border: 4px solid #ffffff;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
  transition:
    transform 0.2s ease,
    filter 0.2s ease;
  cursor: pointer;
  position: relative;
  isolation: isolate;
  transform-style: preserve-3d;
  box-sizing: border-box;
}

.avatar-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 50%;
  overflow: hidden;
  background: linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.2) 0%,
    rgba(255, 255, 255, 0) 50%,
    rgba(0, 0, 0, 0.1) 100%
  );
  opacity: 1;
  transition: all 0.3s ease;
  pointer-events: none;
  z-index: 3;
  mix-blend-mode: overlay; /* 添加混合模式增强效果 */
}

.avatar-wrapper.active .avatar-inner {
  transform: scale(1.2) translateY(-10px);
}

.avatar-wrapper.has-link {
  position: relative;
  cursor: pointer;
}

.avatar-wrapper.has-link::before {
  content: "";
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: linear-gradient(45deg, #ff3366, #ff6b6b, #4ecdc4, #45b7d1, #96e6a1);
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: -1;
  filter: blur(8px);
}

.avatar-wrapper.has-link:hover::before {
  opacity: 0.8;
  animation: borderGlow 2s linear infinite;
}

.glow-effect {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: transparent;
  border: 2px solid transparent;
  transition: all 0.3s ease;
  z-index: 2;
}

.avatar-wrapper.has-link:hover .glow-effect {
  border-color: rgba(255, 255, 255, 0.5);
  box-shadow:
    0 0 20px rgba(255, 255, 255, 0.3),
    inset 0 0 20px rgba(255, 255, 255, 0.3);
}

@keyframes borderGlow {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

/* 确保激活状态下的发光效果仍然可见 */
.avatar-wrapper.active.has-link::before {
  z-index: -1;
}

.avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  overflow: hidden;
  object-fit: cover;
  position: relative;
  z-index: 2;
}

.dialog-box {
  position: absolute;
  top: -120px; /* 稍微上调对话框位置 */
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  padding: 16px 20px;
  border-radius: 16px;
  box-shadow:
    0 4px 24px -1px rgba(0, 0, 0, 0.1),
    0 2px 8px -1px rgba(0, 0, 0, 0.06),
    inset 0 0 0 1px rgba(255, 255, 255, 0.5),
    0 0 40px rgba(142, 68, 173, 0.05);
  min-width: 180px;
  z-index: 111;
  opacity: 0;
  animation: dialogFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  border: 1px solid rgba(0, 0, 0, 0.05);
  will-change: transform, opacity;
  backface-visibility: hidden;
  transform: translateZ(0);
}

.dialog-content {
  position: relative;
  font-size: 15px;
  line-height: 1.6;
  color: #2c3e50;
  margin: 0;
  text-align: center;
  text-shadow: 0 1px 1px rgba(255, 255, 255, 0.5);
}

/* 修改引号装饰的样式 */
.dialog-content::before,
.dialog-content::after {
  content: '"';
  position: absolute;
  font-size: 28px;
  color: #8e44ad;
  opacity: 0.15;
  text-shadow: none;
}

.dialog-content::before {
  left: -15px;
  top: -12px;
}

.dialog-content::after {
  right: -15px;
  bottom: -24px;
}

/* 优化淡入动画，使其更加流畅 */
@keyframes dialogFadeIn {
  0% {
    opacity: 0;
    transform: translateX(-50%) translateY(10px) scale(0.98);
    filter: blur(1px);
  }
  100% {
    opacity: 1;
    transform: translateX(-50%) translateY(0) scale(1);
    filter: blur(0);
  }
}

/* 优化打字效果容器样式 */
.type-it-container {
  min-height: 24px;
  padding: 4px 8px;
  position: relative;
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.5), rgba(255, 255, 255, 0));
  border-radius: 8px;
}

/* 添加打字光标样式 */
.ti-cursor {
  color: #8e44ad;
  font-weight: 300;
}

.name-tag {
  position: absolute;
  bottom: -10px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  color: #2c3e50;
  opacity: 1;
  font-weight: 500;
  font-size: 12px;
  z-index: 20;
  background-color: #fff;
  border-radius: 15px;
  padding: 0px 10px;
  white-space: nowrap; /* 防止文字换行 */
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

/* 添加新的样式 */
.description {
  text-align: center;
  margin-bottom: 40px;
  color: #666;
  line-height: 1.6;
  max-width: 600px;
  margin-inline: auto;
}

.description p {
  margin: 8px 0;
  font-size: 16px;
}

.bottom-text {
  text-align: center;
  margin-top: 60px;
  color: #666;
  line-height: 1.6;
}

.bottom-text p {
  margin: 8px 0;
  font-size: 16px;
}

.sponsor-button {
  position: fixed;
  bottom: 40px;
  right: 40px;
  background: linear-gradient(45deg, #ff3366, #ff6b6b);
  color: white;
  padding: 12px 24px;
  border-radius: 30px;
  text-decoration: none;
  font-weight: 500;
  font-size: 16px;
  box-shadow:
    0 4px 15px rgba(255, 51, 102, 0.3),
    0 2px 8px rgba(255, 51, 102, 0.2);
  transition: all 0.3s ease;
  z-index: 1000;
}

.sponsor-button:hover {
  transform: translateY(-2px);
  box-shadow:
    0 6px 20px rgba(255, 51, 102, 0.4),
    0 3px 10px rgba(255, 51, 102, 0.3);
}

.button-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.heart-icon {
  width: 20px;
  height: 20px;
  fill: currentColor;
  animation: heartBeat 1.2s ease-in-out infinite;
}

@keyframes heartBeat {
  0% {
    transform: scale(1);
  }
  14% {
    transform: scale(1.3);
  }
  28% {
    transform: scale(1);
  }
  42% {
    transform: scale(1.3);
  }
  70% {
    transform: scale(1);
  }
}

/* 添加响应式样式 */
@media (max-width: 768px) {
  .sponsor-button {
    bottom: 20px;
    right: 20px;
    padding: 10px 20px;
    font-size: 14px;
  }

  .description,
  .bottom-text {
    padding: 0 20px;
  }
}

/* 添加悬浮状态的阴影效果 */
.sponsor-avatar:hover {
  filter: drop-shadow(0 8px 12px rgba(0, 0, 0, 0.15));
}

/* 修改激活状态的阴影效果 */
.sponsor-avatar:has(.avatar-wrapper.active) {
  filter: drop-shadow(0 15px 25px rgba(0, 0, 0, 0.2));
}
</style>
