BACKOUT  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING BACKOUT,12
         MODESET KEY=NZERO,MODE=PROB
         LM    14,12,12(13)
         SR    15,15
         BR    14
         END
