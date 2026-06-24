"""
train_models.py — OmniFlow AI 2.0 Phase 2 ML Training Script
=============================================================
Standalone script (NOT part of the Node.js backend).
Run from inside the ml/ directory:

    pip install -r requirements.txt
    python train_models.py

Outputs:
    ml/models/purchase_model.onnx   — XGBClassifier exported to ONNX
    ml/models/value_model.onnx      — XGBRegressor exported to ONNX
    ml/models/feature_order.json    — Exact feature column order used during training
                                      (Node.js reads this to build input tensors)
"""

import os
import json
import math
import pathlib

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score, mean_squared_error
import xgboost as xgb
import onnx
import onnxmltools
from skl2onnx.common.data_types import FloatTensorType

# ─── Configuration ─────────────────────────────────────────────────────────────

RANDOM_SEED = 42
N_ROWS = 5000
MODELS_DIR = pathlib.Path(__file__).parent / "models"

# Feature columns — in this EXACT order; Node.js reads feature_order.json to
# build its input tensors. Do not reorder without re-running this script.
FEATURE_COLUMNS = [
    "budgetSensitivity",
    "buyingFrequency",
    "responseSpeed",
    "lifetimeValue",
    "sentiment",
    "urgency",
]

# ─── 1. Generate synthetic data ────────────────────────────────────────────────

def generate_data(n: int, seed: int) -> pd.DataFrame:
    """
    Generate n rows of synthetic mock data with realistic (non-random) correlations
    matching the CustomerProfile and Conversation schema.
    """
    rng = np.random.default_rng(seed)

    # Raw features ── all drawn from uniform distributions within spec ranges
    budget_sensitivity = rng.uniform(0.0, 1.0, n)       # 0–1
    buying_frequency   = rng.uniform(0.0, 1.0, n)       # 0–1
    response_speed     = rng.uniform(0.0, 1.0, n)       # 0–1
    lifetime_value     = rng.uniform(0.0, 50_000.0, n)  # 0–50000
    sentiment          = rng.uniform(-1.0, 1.0, n)      # -1 to 1
    urgency            = rng.uniform(0.0, 1.0, n)       # 0–1

    # ── Target 1: purchase_label (binary) ──────────────────────────────────────
    # Logit = weighted sum with realistic signs + small Gaussian noise
    #   + buying_frequency   (more likely to buy if they buy often)
    #   + urgency            (urgent customers convert more)
    #   + 0.5 * sentiment    (positive sentiment helps)
    #   - 0.8 * budget_sensitivity  (price-sensitive customers buy less)
    #   intercept -0.3 to centre around ~45% base conversion
    noise_cls = rng.normal(0, 0.3, n)
    logit = (
          1.5 * buying_frequency
        + 1.2 * urgency
        + 0.5 * ((sentiment + 1) / 2)   # rescale -1..1 → 0..1
        - 0.8 * budget_sensitivity
        - 0.3
        + noise_cls
    )
    prob = 1.0 / (1.0 + np.exp(-logit))   # sigmoid
    purchase_label = (prob > 0.5).astype(int)

    # ── Target 2: order_value (float) ──────────────────────────────────────────
    # Correlates with lifetimeValue (rich customers spend more),
    # inversely with budgetSensitivity (price-sensitive → smaller orders)
    noise_reg = rng.normal(0, 20, n)
    order_value = (
          0.08 * lifetime_value          # scales with LTV
        - 60.0 * budget_sensitivity      # budget-sensitive → lower order
        + 30.0 * buying_frequency        # frequent buyers add more per order
        + 20.0                           # base intercept
        + noise_reg
    ).clip(0, None)                      # order values can't be negative

    df = pd.DataFrame({
        "budgetSensitivity": budget_sensitivity,
        "buyingFrequency":   buying_frequency,
        "responseSpeed":     response_speed,
        "lifetimeValue":     lifetime_value,
        "sentiment":         sentiment,
        "urgency":           urgency,
        "purchase_label":    purchase_label,
        "order_value":       order_value,
    })

    return df

# ─── 2. Train models ───────────────────────────────────────────────────────────

def train_and_evaluate(df: pd.DataFrame):
    X = df[FEATURE_COLUMNS].astype(np.float32)
    X.columns = [f"f{i}" for i in range(len(FEATURE_COLUMNS))]
    y_cls = df["purchase_label"]
    y_reg = df["order_value"].astype(np.float32)

    X_train, X_test, y_cls_train, y_cls_test, y_reg_train, y_reg_test = train_test_split(
        X, y_cls, y_reg, test_size=0.2, random_state=RANDOM_SEED
    )

    # ── Classifier ─────────────────────────────────────────────────────────────
    print("\n── Training XGBClassifier ─────────────────────────────")
    clf = xgb.XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        use_label_encoder=False,
        eval_metric="logloss",
        random_state=RANDOM_SEED,
    )
    clf.fit(X_train, y_cls_train, eval_set=[(X_test, y_cls_test)], verbose=False)

    y_pred_cls  = clf.predict(X_test)
    y_proba_cls = clf.predict_proba(X_test)[:, 1]
    acc = accuracy_score(y_cls_test, y_pred_cls)
    auc = roc_auc_score(y_cls_test, y_proba_cls)
    print(f"  Accuracy : {acc:.4f}")
    print(f"  AUC-ROC  : {auc:.4f}")

    # ── Regressor ──────────────────────────────────────────────────────────────
    print("\n── Training XGBRegressor ──────────────────────────────")
    reg = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=RANDOM_SEED,
    )
    reg.fit(X_train, y_reg_train, eval_set=[(X_test, y_reg_test)], verbose=False)

    y_pred_reg = reg.predict(X_test)
    rmse = math.sqrt(mean_squared_error(y_reg_test, y_pred_reg))
    print(f"  RMSE     : {rmse:.4f}")

    return clf, reg, X_test, y_cls_test, y_reg_test, y_pred_cls, y_proba_cls, y_pred_reg

# ─── 3. Export to ONNX ────────────────────────────────────────────────────────

def export_to_onnx(clf, reg, models_dir: pathlib.Path):
    models_dir.mkdir(parents=True, exist_ok=True)

    n_features = len(FEATURE_COLUMNS)
    initial_type = [("float_input", FloatTensorType([None, n_features]))]

    # ── Purchase classifier → ONNX ─────────────────────────────────────────────
    print("\n── Exporting purchase_model.onnx ──────────────────────")
    onnx_clf = onnxmltools.convert_xgboost(
        clf,
        initial_types=initial_type,
        target_opset=12,
    )
    clf_path = models_dir / "purchase_model.onnx"
    onnx.save_model(onnx_clf, str(clf_path))
    print(f"  Saved: {clf_path}")

    # ── Order value regressor → ONNX ───────────────────────────────────────────
    print("\n── Exporting value_model.onnx ─────────────────────────")
    onnx_reg = onnxmltools.convert_xgboost(
        reg,
        initial_types=initial_type,
        target_opset=12,
    )
    reg_path = models_dir / "value_model.onnx"
    onnx.save_model(onnx_reg, str(reg_path))
    print(f"  Saved: {reg_path}")

    return clf_path, reg_path

# ─── 4. Save feature order ────────────────────────────────────────────────────

def save_feature_order(models_dir: pathlib.Path):
    feature_order_path = models_dir / "feature_order.json"
    with open(feature_order_path, "w") as f:
        json.dump(FEATURE_COLUMNS, f, indent=2)
    print(f"\n── Feature order saved: {feature_order_path}")
    print(f"   {FEATURE_COLUMNS}")
    return feature_order_path

# ─── 5. Sample predictions ────────────────────────────────────────────────────

def print_sample_predictions(clf, reg, X_test):
    sample = X_test.iloc[:3].copy()
    proba = clf.predict_proba(sample)[:, 1]
    value = reg.predict(sample)

    print("\n── Sample predictions (first 3 test rows) ─────────────")
    for i in range(3):
        row = sample.iloc[i]
        print(f"\n  Row {i + 1}:")
        for idx, col in enumerate(FEATURE_COLUMNS):
            print(f"    {col:20s} = {row[f'f{idx}']:.4f}")
        print(f"    → purchase_probability = {proba[i]:.4f}")
        print(f"    → expected_order_value = {value[i]:.2f}")

        # Sanity checks
        assert not math.isnan(proba[i]), "NaN in purchase_probability!"
        assert not math.isnan(value[i]), "NaN in expected_order_value!"
        assert 0.0 <= proba[i] <= 1.0,   "purchase_probability out of [0,1]!"

    print("\n  ✓ No NaNs detected in sample predictions.")

# ─── Main ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("=" * 58)
    print("  OmniFlow AI 2.0 — ML Training Script")
    print("=" * 58)

    # 1. Generate data
    print(f"\n[1/5] Generating {N_ROWS} rows of synthetic data...")
    df = generate_data(N_ROWS, RANDOM_SEED)
    purchase_rate = df["purchase_label"].mean()
    print(f"      purchase_label rate : {purchase_rate:.3f}")
    print(f"      order_value  mean   : {df['order_value'].mean():.2f}")
    print(f"      order_value  std    : {df['order_value'].std():.2f}")
    assert not df.isnull().any().any(), "NaN found in generated data!"
    print(f"      ✓ No NaNs in generated data.")

    # 2. Train & evaluate
    print("\n[2/5] Training models...")
    clf, reg, X_test, y_cls_test, y_reg_test, y_pred_cls, y_proba_cls, y_pred_reg = \
        train_and_evaluate(df)

    # 3. Export ONNX
    print("\n[3/5] Exporting ONNX models...")
    clf_path, reg_path = export_to_onnx(clf, reg, MODELS_DIR)

    # 4. Save feature order
    print("\n[4/5] Saving feature order...")
    feature_order_path = save_feature_order(MODELS_DIR)

    # 5. Sample predictions
    print("\n[5/5] Sample predictions...")
    print_sample_predictions(clf, reg, X_test)

    # ── Final summary ──────────────────────────────────────────────────────────
    print("\n" + "=" * 58)
    print("  TRAINING COMPLETE — SUMMARY")
    print("=" * 58)
    print(f"  Rows generated      : {N_ROWS}")
    print(f"  Feature order       : {FEATURE_COLUMNS}")
    print(f"  purchase_model.onnx : {clf_path}")
    print(f"  value_model.onnx    : {reg_path}")
    print(f"  feature_order.json  : {feature_order_path}")
    print(f"\n  Files exist?")
    print(f"    purchase_model.onnx : {clf_path.exists()}")
    print(f"    value_model.onnx    : {reg_path.exists()}")
    print(f"    feature_order.json  : {feature_order_path.exists()}")
    print("=" * 58)
