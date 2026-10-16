import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ configured: true, supabase: { auth } }));
import { Login } from "./Login";
beforeEach(() => vi.clearAllMocks());
it("signs up any email with a timezone and active session, without a verification step", async () => {
  auth.signUp.mockResolvedValue({
    data: { session: { user: { id: "new" } } },
    error: null,
  });
  const user = userEvent.setup();
  render(<Login onPreview={vi.fn()} recovery={false} onRecovered={vi.fn()} />);
  expect(
    screen.queryByRole("button", { name: /Forgot/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign up" }));
  await user.type(screen.getByLabelText("Email"), "new-person@example.test");
  await user.type(screen.getByLabelText("Password"), "a-good-test-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() =>
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "new-person@example.test",
      password: "a-good-test-password",
      options: {
        data: {
          signup_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    }),
  );
  expect(screen.queryByText(/Check your email/)).not.toBeInTheDocument();
});
it("retains duplicate-email errors and the eight-character password minimum", async () => {
  auth.signUp.mockResolvedValue({
    data: { session: null },
    error: new Error("User already registered"),
  });
  const user = userEvent.setup();
  render(<Login onPreview={vi.fn()} recovery={false} onRecovered={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Sign up" }));
  await user.type(screen.getByLabelText("Email"), "someone@example.test");
  expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "8");
  await user.type(screen.getByLabelText("Password"), "test-password");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "User already registered",
  );
});
