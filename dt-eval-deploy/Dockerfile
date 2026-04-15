FROM public.ecr.aws/lambda/nodejs20.x

WORKDIR ${LAMBDA_TASK_ROOT}

# dist/ is a self-contained CJS bundle (dt-eval-lib is bundled in via tsup noExternal)
# so we only need the built artifact — no npm install required at runtime
COPY dist/ ./dist/

CMD ["dist/index.handler"]
