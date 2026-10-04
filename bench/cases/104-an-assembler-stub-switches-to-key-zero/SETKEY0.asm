SETKEY0  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING SETKEY0,12
         MODESET KEY=ZERO
         L     2,0(,1)
         MVC   0(16,2),PSA
         MODESET KEY=NZERO
         LM    14,12,12(13)
         SR    15,15
         BR    14
PSA      DS    CL16
         END
