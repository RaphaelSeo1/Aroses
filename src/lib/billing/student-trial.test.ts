import assert from "node:assert/strict";
import test from "node:test";
import {
  STUDENT_TRIAL_DAYS,
  isStudentTrialActive,
  studentTrialDaysForCheckout,
} from "./student-trial.ts";

function withTrialEnv(
  values: {
    server?: string | undefined;
    pub?: string | undefined;
  },
  fn: () => void
) {
  const prevServer = process.env.STUDENT_TRIAL_ENABLED;
  const prevPub = process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED;
  if (values.server === undefined) delete process.env.STUDENT_TRIAL_ENABLED;
  else process.env.STUDENT_TRIAL_ENABLED = values.server;
  if (values.pub === undefined) delete process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED;
  else process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED = values.pub;
  try {
    fn();
  } finally {
    if (prevServer === undefined) delete process.env.STUDENT_TRIAL_ENABLED;
    else process.env.STUDENT_TRIAL_ENABLED = prevServer;
    if (prevPub === undefined) delete process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED;
    else process.env.NEXT_PUBLIC_STUDENT_TRIAL_ENABLED = prevPub;
  }
}

test("student trial defaults ON and only applies to Student", () => {
  withTrialEnv({}, () => {
    assert.equal(isStudentTrialActive(), true);
    assert.equal(studentTrialDaysForCheckout("student"), STUDENT_TRIAL_DAYS);
    assert.equal(studentTrialDaysForCheckout("basic"), null);
    assert.equal(studentTrialDaysForCheckout("plus"), null);
    assert.equal(studentTrialDaysForCheckout("advanced"), null);
    assert.equal(studentTrialDaysForCheckout("premium"), null);
  });
});

test("STUDENT_TRIAL_ENABLED=false disables trial even if public flag is on", () => {
  withTrialEnv({ server: "false", pub: "true" }, () => {
    assert.equal(isStudentTrialActive(), false);
    assert.equal(studentTrialDaysForCheckout("student"), null);
  });
});

test("public flag is used when the server flag is unset", () => {
  withTrialEnv({ pub: "false" }, () => {
    assert.equal(isStudentTrialActive(), false);
    assert.equal(studentTrialDaysForCheckout("student"), null);
  });
  withTrialEnv({ pub: "true" }, () => {
    assert.equal(isStudentTrialActive(), true);
    assert.equal(studentTrialDaysForCheckout("student"), 3);
  });
});
