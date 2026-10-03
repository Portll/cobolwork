STUBSUP  CSECT
         STM   14,12,12(13)
         LR    12,15
         USING STUBSUP,12
         MODESET MODE=SUP
         L     2,0(,1)
         MVC   0(16,2),PSA
         MODESET MODE=PROB
         LM    14,12,12(13)
         SR    15,15
         BR    14
PSA      DS    CL16
         END
