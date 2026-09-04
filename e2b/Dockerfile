# Luxy AI — custom E2B sandbox template (BLUEPRINT.md §4.5)
#
# Build and publish once, then reference it from LuxySandbox:
#   cd e2b && e2b template build --name luxy-trading
#
# The Luxy agent picks the template up automatically via the
# template name in src/e2b/sandbox.ts.
FROM e2b/code-interpreter:latest

RUN pip install --no-cache-dir \
    pandas==2.2.0 \
    numpy==1.26.4 \
    matplotlib==3.8.0 \
    scikit-learn==1.4.0 \
    ta==0.11.0 \
    requests==2.31.0 \
    scipy==1.12.0

# Pre-baked analysis templates the agent can load and adapt in-session
# (BLUEPRINT.md §4.4): momentum backtest, Kelly sizing, liquidity depth.
COPY templates/ /home/user/templates/
