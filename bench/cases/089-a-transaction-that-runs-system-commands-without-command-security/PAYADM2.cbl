       IDENTIFICATION DIVISION.
       PROGRAM-ID. PAYADM2.
      * The same commands, on a transaction that turns command security on.
       PROCEDURE DIVISION.
           EXEC CICS SET TERMINAL('T002') INSERVICE END-EXEC
           EXEC CICS RETURN END-EXEC.
