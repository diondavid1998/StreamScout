//
//  AuthView.swift
//  WhatsOn
//
// Sign in, register, and the forgotten-password exchange.
//

import SwiftUI

// MARK: - Auth

struct AuthView: View {
    @Environment(AppState.self) private var app

    enum Mode: CaseIterable { case login, register }
    enum ResetStep { case none, enterEmail, enterCode }

    @State private var mode: Mode = .login
    @State private var username = ""
    @State private var password = ""
    @State private var registerEmail = ""
    @State private var isLoading = false
    @State private var errorMsg: String?
    @State private var successMsg: String?

    // Forgot password
    @State private var resetStep: ResetStep = .none
    @State private var resetEmail = ""
    @State private var resetCode = ""
    @State private var resetNewPass = ""

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                // Hero
                VStack(spacing: 10) {
                    WhatsOnTitle(size: 34, logoSize: 40)
                        .padding(.top, 60)
                    Text("Your streaming catalog, unified.")
                        .font(.subheadline)
                        .foregroundColor(.mkMuted)
                        .padding(.bottom, 36)
                }

                // Card
                VStack(spacing: 18) {
                    if resetStep == .enterEmail {
                        resetEmailCard
                    } else if resetStep == .enterCode {
                        resetCodeCard
                    } else {
                        mainAuthCard
                    }
                }
                .padding(24)
                .background(Color.mkSurface)
                .clipShape(RoundedRectangle(cornerRadius: 24))
                .overlay(RoundedRectangle(cornerRadius: 24).stroke(Color.mkBorder, lineWidth: 1))
                .padding(.horizontal, 20)
                .padding(.bottom, 40)
            }
        }
        .scrollBounceBehavior(.basedOnSize)
    }

    // MARK: Main auth card

    var mainAuthCard: some View {
        VStack(spacing: 18) {
            HStack(spacing: 0) {
                ForEach(Mode.allCases, id: \.self) { m in
                    Button {
                        withAnimation(.spring(duration: 0.22)) { mode = m; clearMessages() }
                    } label: {
                        Text(m == .login ? "Sign In" : "Register")
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(mode == m ? Color.mkAccent : Color.clear)
                            .foregroundColor(mode == m ? .mkOnAccent : .mkMuted)
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                }
            }
            .padding(4)
            .background(Color.mkBackground)
            .clipShape(RoundedRectangle(cornerRadius: 13))

            MKTextField(placeholder: "Username", text: $username, icon: "person.fill")

            if mode == .register {
                MKTextField(placeholder: "Email (optional — for password reset)", text: $registerEmail, icon: "envelope.fill")
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            MKTextField(placeholder: "Password", text: $password, icon: "lock.fill", isSecure: true)

            feedbackView

            MKButton(
                label: isLoading ? "Working…" : (mode == .login ? "Sign In" : "Create Account"),
                icon: mode == .login ? "arrow.right.circle.fill" : "person.badge.plus",
                isLoading: isLoading
            ) { Task { await authenticate() } }

            if mode == .login {
                Button {
                    withAnimation { resetStep = .enterEmail; clearMessages() }
                } label: {
                    Text("Forgot password?")
                        .font(.footnote)
                        .foregroundColor(.mkMuted)
                }
            }
        }
    }

    // MARK: Reset step 1 — enter email

    var resetEmailCard: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("Reset Password")
                    .font(.title3.weight(.bold))
                    .foregroundColor(.mkText)
                Text("Enter the email on your account and we'll send a code.")
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .multilineTextAlignment(.center)
            }
            MKTextField(placeholder: "Email address", text: $resetEmail, icon: "envelope.fill")
            feedbackView
            MKButton(label: isLoading ? "Sending…" : "Send Reset Code",
                     icon: "paperplane.fill", isLoading: isLoading) {
                Task { await sendResetCode() }
            }
            Button { withAnimation { resetStep = .none; clearMessages() } } label: {
                Text("← Back to Sign In").font(.footnote).foregroundColor(.mkMuted)
            }
        }
    }

    // MARK: Reset step 2 — enter code + new password

    var resetCodeCard: some View {
        VStack(spacing: 18) {
            VStack(spacing: 4) {
                Text("Enter Code")
                    .font(.title3.weight(.bold))
                    .foregroundColor(.mkText)
                Text("Enter the 6-digit code sent to \(resetEmail) and your new password.")
                    .font(.caption)
                    .foregroundColor(.mkMuted)
                    .multilineTextAlignment(.center)
            }
            MKTextField(placeholder: "6-digit code", text: $resetCode, icon: "number.circle.fill")
            MKTextField(placeholder: "New password", text: $resetNewPass, icon: "lock.fill", isSecure: true)
            feedbackView
            MKButton(label: isLoading ? "Resetting…" : "Reset Password",
                     icon: "checkmark.circle.fill", isLoading: isLoading) {
                Task { await submitReset() }
            }
            Button { withAnimation { resetStep = .enterEmail; clearMessages() } } label: {
                Text("← Re-send code").font(.footnote).foregroundColor(.mkMuted)
            }
        }
    }

    @ViewBuilder
    var feedbackView: some View {
        if let err = errorMsg {
            Text(err).font(.caption).foregroundColor(.mkAccent)
                .multilineTextAlignment(.center).padding(.horizontal, 4)
        } else if let ok = successMsg {
            Text(ok).font(.caption).foregroundColor(Color(red: 0.1, green: 0.8, blue: 0.5))
                .multilineTextAlignment(.center).padding(.horizontal, 4)
        }
    }

    func clearMessages() { errorMsg = nil; successMsg = nil }

    // MARK: Auth

    func authenticate() async {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces)
        guard !trimmedUser.isEmpty, !password.isEmpty else {
            errorMsg = "Please fill in both fields."; return
        }
        isLoading = true; clearMessages()
        do {
            var body: [String: Any] = ["username": trimmedUser, "password": password]
            if mode == .register, !registerEmail.isEmpty { body["email"] = registerEmail }
            let resp: AuthResponse = try await APIService.shared.post(
                mode == .login ? "/login" : "/register", body: body
            )
            if let t = resp.token {
                app.saveSession(token: t, username: trimmedUser, isNewUser: mode == .register)
            } else {
                errorMsg = resp.error ?? "Authentication failed."
            }
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }

    // MARK: Password Reset

    func sendResetCode() async {
        guard !resetEmail.isEmpty else { errorMsg = "Enter your email address."; return }
        isLoading = true; clearMessages()
        do {
            let resp: ForgotPasswordResponse = try await APIService.shared.post(
                "/auth/forgot-password", body: ["email": resetEmail]
            )
            _ = resp
            successMsg = "Code sent! Check your email."
            withAnimation { resetStep = .enterCode }
        } catch {
            // Backend always returns 200 so any error is a network issue
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }

    func submitReset() async {
        guard !resetCode.isEmpty, !resetNewPass.isEmpty else {
            errorMsg = "Enter both the code and a new password."; return
        }
        isLoading = true; clearMessages()
        do {
            let resp: ForgotPasswordResponse = try await APIService.shared.post(
                "/auth/reset-password",
                body: ["email": resetEmail, "code": resetCode, "newPassword": resetNewPass]
            )
            if resp.success == true {
                successMsg = "Password reset! Sign in with your new password."
                withAnimation { resetStep = .none; mode = .login }
                resetCode = ""; resetNewPass = ""
            } else {
                errorMsg = resp.error ?? "Invalid code or it has expired."
            }
        } catch {
            errorMsg = (error as? APIError)?.errorDescription ?? "Network error."
        }
        isLoading = false
    }
}
