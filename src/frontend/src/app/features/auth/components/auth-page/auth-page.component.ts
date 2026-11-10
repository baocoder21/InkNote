import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from '@angular/core';
import { AbstractControl, NonNullableFormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzInputDirective } from 'ng-zorro-antd/input';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../models/auth.model';
import { safeReturnUrl } from '../../safe-return-url';
import { AuthStore, SignInResult } from '../../store/auth.store';

type Mode = 'login' | 'register';

/**
 * The sign-in and register pages: one component, two routes (the route's `data: { mode }` is bound
 * to the `mode` input; `?returnUrl=` to `returnUrl`). They share the same two fields and layout.
 */
@Component({
  selector: 'app-auth-page',
  imports: [ReactiveFormsModule, RouterLink, NzButtonComponent, NzIconDirective, NzInputDirective],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthPageComponent {
  readonly mode = input<Mode>('login'); // route data
  readonly returnUrl = input<string>(); // ?returnUrl=...

  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  protected readonly isRegister = computed(() => this.mode() === 'register');
  protected readonly passwordMin = PASSWORD_MIN_LENGTH;
  protected readonly busy = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      email: ['', [Validators.required, Validators.email, Validators.maxLength(256)]],
      password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)]],
      confirm: [''],
      // Off by default: on a shared computer the safe choice must be the one nobody has to think about.
      remember: [false],
    },
    { validators: (group: AbstractControl): ValidationErrors | null => this.confirmMatches(group) },
  );

  constructor() {
    // Put the cursor in the first field (after the page is on screen).
    afterNextRender(() => this.emailInput()?.nativeElement.focus());
  }

  /** The register page asks for the password twice (a typo would lock the user out of a new account). */
  private confirmMatches(group: AbstractControl): ValidationErrors | null {
    if (!this.isRegister()) {
      return null;
    }
    return group.get('password')?.value === group.get('confirm')?.value ? null : { mismatch: true };
  }

  // Errors are shown only after the user tried to submit or left the field: not while still typing.
  private show(name: 'email' | 'password' | 'confirm'): boolean {
    const control = this.form.controls[name];
    return this.submitted() || control.touched;
  }

  protected emailError(): string | null {
    if (!this.show('email')) return null;
    const errors = this.form.controls.email.errors;
    if (errors?.['required']) return 'Enter your email.';
    if (errors?.['email'] || errors?.['maxlength']) return 'Enter a valid email address.';
    return null;
  }

  protected passwordError(): string | null {
    if (!this.show('password')) return null;
    const errors = this.form.controls.password.errors;
    if (errors?.['required']) return 'Enter your password.';
    // The length rule only matters when CHOOSING a password; on login any wrong password is just "wrong".
    if (this.isRegister() && errors?.['minlength']) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (errors?.['maxlength']) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
    return null;
  }

  protected confirmError(): string | null {
    if (!this.isRegister() || !this.show('confirm')) return null;
    return this.form.errors?.['mismatch'] ? 'The passwords do not match.' : null;
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.serverError.set(null);
    const { email, password, remember } = this.form.getRawValue();
    const lengthOk = this.isRegister() ? password.length >= PASSWORD_MIN_LENGTH : true;
    const valid = this.form.controls.email.valid && password.length > 0 && password.length <= PASSWORD_MAX_LENGTH && lengthOk && !this.confirmError();
    if (!valid || this.busy()) {
      return;
    }

    this.busy.set(true);
    const credentials = { email: email.trim(), password, rememberMe: remember };
    const result = this.isRegister() ? await this.auth.register(credentials) : await this.auth.login(credentials);
    this.busy.set(false);

    if (result.status === 'ok') {
      // Only a path inside this app is accepted from the address bar (see safeReturnUrl).
      await this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
      return;
    }
    this.serverError.set(this.messageFor(result));
  }

  private messageFor(result: Exclude<SignInResult, { status: 'ok' }>): string {
    switch (result.status) {
      case 'invalid': {
        const reasons = Object.values(result.fieldErrors ?? {}).flat();
        return reasons.length > 0 ? reasons.join(' ') : 'Invalid email or password.';
      }
      case 'duplicate':
        return 'An account with this email already exists. Sign in instead.';
      case 'too-many':
        return 'Too many attempts. Wait a few minutes and try again.';
      default:
        return 'Cannot reach the server. Is the backend running on port 5032?';
    }
  }
}
