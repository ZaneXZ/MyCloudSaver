<template>
  <div class="login">
    <!-- 背景区域 -->
    <div class="login__background" aria-hidden="true" />

    <!-- 主要内容区 -->
    <main class="login__content">
      <!-- 头部 Logo -->
      <header class="login__header">
        <img :src="logo" alt="Cloud Saver Logo" class="login__logo" width="60" height="60" />
        <h1 class="login__title">Cloud Saver</h1>
      </header>

      <!-- 添加 Tab 切换 -->
      <van-tabs v-model:active="activeTab" class="login__tabs">
        <!-- 登录面板 -->
        <van-tab title="登录" name="login">
          <van-form class="login__form" @submit="handleLogin">
            <van-cell-group inset class="login__form-group">
              <!-- 用户名输入框 -->
              <van-field
                v-model="loginForm.username"
                name="username"
                label="用户名"
                placeholder="请输入用户名"
                :rules="[{ required: true, message: '请填写用户名' }]"
                autocomplete="username"
                @keyup.enter="focusLoginPassword"
              >
                <template #left-icon>
                  <van-icon name="user-o" />
                </template>
              </van-field>

              <!-- 密码输入框 -->
              <van-field
                ref="loginPasswordRef"
                v-model="loginForm.password"
                type="password"
                name="password"
                label="密码"
                placeholder="请输入密码"
                :rules="[{ required: true, message: '请填写密码' }]"
                autocomplete="current-password"
                @keyup.enter="handleLogin"
              >
                <template #left-icon>
                  <van-icon name="lock" />
                </template>
              </van-field>

              <!-- 优化记住密码选项 -->
              <div class="login__remember">
                <van-checkbox v-model="rememberPassword" class="remember-checkbox">
                  记住密码
                </van-checkbox>
              </div>
            </van-cell-group>

            <!-- 登录按钮 -->
            <div class="login__submit">
              <van-button
                :loading="isLoading"
                :disabled="isLoading"
                round
                block
                type="primary"
                native-type="submit"
                class="login__button"
              >
                {{ isLoading ? "登录中..." : "登录" }}
              </van-button>
            </div>
          </van-form>
        </van-tab>

        <!-- 注册面板 -->
        <van-tab title="注册" name="register">
          <van-form class="login__form" @submit="handleRegister">
            <van-cell-group inset class="login__form-group">
              <van-field
                v-model="registerForm.username"
                name="username"
                label="用户名"
                placeholder="请输入用户名"
                :rules="usernameRules"
              >
                <template #left-icon>
                  <van-icon name="user-o" />
                </template>
              </van-field>

              <van-field
                v-model="registerForm.password"
                type="password"
                name="password"
                label="密码"
                placeholder="请输入密码"
                :rules="passwordRules"
              >
                <template #left-icon>
                  <van-icon name="lock" />
                </template>
              </van-field>

              <van-field
                v-model="registerForm.confirmPassword"
                type="password"
                name="confirmPassword"
                label="确认密码"
                placeholder="请确认密码"
                :rules="confirmPasswordRules"
              >
                <template #left-icon>
                  <van-icon name="lock" />
                </template>
              </van-field>

              <van-field
                v-model="registerForm.registerCode"
                name="registerCode"
                label="注册码"
                placeholder="请输入注册码"
                :rules="registerCodeRules"
              >
                <template #left-icon>
                  <van-icon name="certificate" />
                </template>
              </van-field>
            </van-cell-group>

            <div class="login__submit">
              <van-button
                :loading="isLoading"
                :disabled="isLoading"
                round
                block
                type="primary"
                native-type="submit"
                class="login__button"
              >
                {{ isLoading ? "注册中..." : "注册" }}
              </van-button>
            </div>
          </van-form>
        </van-tab>
      </van-tabs>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { showNotify } from "vant";
import type { FieldInstance, FieldRule } from "vant";
import { userApi } from "@/api/user";
import logo from "@/assets/images/logo.png";
import { STORAGE_KEYS } from "@/constants/storage";

// 类型定义
interface LoginForm {
  username: string;
  password: string;
}

interface RegisterForm {
  username: string;
  password: string;
  confirmPassword: string;
  registerCode: string;
}

// 响应式数据
const activeTab = ref("login");
const isLoading = ref(false);
const loginPasswordRef = ref<FieldInstance>();
const rememberPassword = ref(false);

const loginForm = ref<LoginForm>({
  username: "",
  password: "",
});

const registerForm = ref<RegisterForm>({
  username: "",
  password: "",
  confirmPassword: "",
  registerCode: "",
});

// 工具函数
const router = useRouter();

// 方法定义
const focusLoginPassword = () => {
  loginPasswordRef.value?.focus();
};

// 表单验证
const validateConfirmPassword = (value: string) => {
  return value === registerForm.value.password;
};

// 在组件加载时检查是否有保存的账号密码
onMounted(() => {
  const savedUsername = localStorage.getItem(STORAGE_KEYS.USERNAME);
  const savedPassword = localStorage.getItem(STORAGE_KEYS.PASSWORD);
  if (savedUsername && savedPassword) {
    loginForm.value.username = savedUsername;
    loginForm.value.password = savedPassword;
    rememberPassword.value = true;
  }
});

// 登录处理
const handleLogin = async () => {
  try {
    isLoading.value = true;
    const res = await userApi.login(loginForm.value);

    if (res.code === 0) {
      if (rememberPassword.value) {
        localStorage.setItem(STORAGE_KEYS.USERNAME, loginForm.value.username);
        localStorage.setItem(STORAGE_KEYS.PASSWORD, loginForm.value.password);
      } else {
        localStorage.removeItem(STORAGE_KEYS.USERNAME);
        localStorage.removeItem(STORAGE_KEYS.PASSWORD);
      }

      localStorage.setItem(STORAGE_KEYS.TOKEN, res.data.token);
      await router.push("/");
    } else {
      showNotify({ type: "danger", message: res.message || "登录失败" });
    }
  } catch (error) {
    showNotify({ type: "danger", message: "登录失败" });
  } finally {
    isLoading.value = false;
  }
};

// 注册处理
const handleRegister = async () => {
  try {
    isLoading.value = true;
    const res = await userApi.register({
      username: registerForm.value.username,
      password: registerForm.value.password,
      registerCode: registerForm.value.registerCode,
    });

    if (res.code === 0) {
      showNotify({ type: "success", message: "注册成功" });
      // 自动填充登录表单
      loginForm.value.username = registerForm.value.username;
      loginForm.value.password = registerForm.value.password;
      activeTab.value = "login";
      // 清空注册表单
      registerForm.value = {
        username: "",
        password: "",
        confirmPassword: "",
        registerCode: "",
      };
    } else {
      showNotify({ type: "danger", message: res.message || "注册失败" });
    }
  } catch (error) {
    showNotify({ type: "danger", message: "注册失败" });
  } finally {
    isLoading.value = false;
  }
};

// 定义验证规则
const usernameRules: FieldRule[] = [
  { required: true, message: "请填写用户名" },
  { pattern: /.{3,}/, message: "用户名至少3个字符" },
];

const passwordRules: FieldRule[] = [
  { required: true, message: "请填写密码" },
  { pattern: /.{6,}/, message: "密码至少6个字符" },
];

const confirmPasswordRules: FieldRule[] = [
  { required: true, message: "请确认密码" },
  { validator: validateConfirmPassword, message: "两次密码不一致" },
];

const registerCodeRules: FieldRule[] = [{ required: true, message: "请填写注册码" }];
</script>

<style lang="scss" scoped>
.login {
  position: relative;
  height: 100vh;
  width: 100%;
  overflow: hidden;

  // 背景
  &__background {
    position: absolute;
    inset: 0;
    background: url("@/assets/images/mobile-login-bg.png") no-repeat;
    background-size: 100% auto;
    filter: blur(1px);
  }

  // 主内容区
  &__content {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    min-height: 65%;
    padding: 40px 20px;
    background-color: var(--theme-other_background);
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(8px);
  }

  // 头部
  &__header {
    display: flex;
    justify-content: center;
    align-items: center;
    margin-bottom: 40px;
  }

  &__logo {
    width: 60px;
    height: 60px;
    margin-right: 12px;
    object-fit: contain;
  }

  &__title {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
    color: var(--theme-theme);
  }

  // 表单
  &__form {
    padding: 0;
    margin-top: 20px;
  }

  &__form-group {
    margin: 0 12px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    border-radius: 12px;
    overflow: hidden;
  }

  &__submit {
    margin: 32px 12px 0;
  }

  &__button {
    height: 48px;
    font-size: 16px;
    font-weight: 500;
  }

  // 记住密码区域
  &__remember {
    padding: 12px 16px;
    border-top: 0.5px solid #f5f5f5;
  }

  &__tabs {
    :deep() {
      .van-tabs__wrap {
        padding: 0 12px;
      }

      .van-tabs__nav {
        background: transparent;
      }

      .van-tab {
        color: var(--theme-color);
        font-size: 16px;
      }

      .van-tab--active {
        color: var(--theme-theme);
        font-weight: 500;
      }

      .van-tabs__line {
        background-color: var(--theme-theme);
      }
    }
  }
}

// Vant 组件样式优化
:deep(.van-cell-group--inset) {
  margin: 0;
}

:deep(.van-field) {
  padding: 16px;

  .van-field__label {
    width: 4em;
    color: var(--theme-color);
    font-size: 15px;
  }

  .van-field__value {
    .van-field__body {
      input {
        font-size: 15px;
      }
    }
  }

  .van-field__left-icon {
    margin-right: 8px;
    font-size: 18px;
  }
}

// 记住密码复选框样式优化
:deep(.remember-checkbox) {
  display: flex;
  align-items: center;
  font-size: 14px;
  color: #666;

  .van-checkbox__icon {
    font-size: 16px;

    .van-icon {
      border: 1px solid #dcdee0;
      border-radius: 2px;
      transition: all 0.2s;
    }
  }

  .van-checkbox__label {
    margin-left: 6px;
    line-height: 1;
  }

  &.van-checkbox--checked {
    .van-icon {
      background-color: var(--theme-theme);
      border-color: var(--theme-theme);
    }
  }
}
</style>
